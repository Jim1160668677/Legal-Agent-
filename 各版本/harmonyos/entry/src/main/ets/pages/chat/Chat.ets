/**
 * HarmonyOS - 聊天页面
 */
import { router } from '@kit.ArkUI';
import { LegalAgentSDK, SSEMessage } from '../sdk/LegalAgentSDK';
import { MessageBubble } from '../components/MessageBubble';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ChatMessage, LawReference } from '../models/ChatMessage';
import { ChatSession } from '../models/ChatSession';
import { formatTime, formatRelativeTime } from '../utils/DateUtil';
import { MESSAGE_PAGE_SIZE } from '../utils/Constants';

@Entry
@Component
struct ChatPage {
  @State messages: ChatMessage[] = [];
  @State inputValue: string = '';
  @State isLoading: boolean = false;
  @State isTyping: boolean = false;
  @State sessions: ChatSession[] = [];
  @State showSessionList: boolean = false;
  @State currentSession: ChatSession | null = null;
  @State isLoadingHistory: boolean = false;
  @State hasMoreMessages: boolean = false;
  @State currentPage: number = 1;
  private sessionId: string = '';

  private sdk: LegalAgentSDK = new LegalAgentSDK();

  aboutToAppear() {
    this.loadSessionList();
  }

  async loadSessionList() {
    try {
      const result = await this.sdk.getSessionList(1, 50);
      this.sessions = result.data ?? [];
    } catch (error) {
      console.error('加载会话列表失败:', error);
    }
  }

  async switchSession(session: ChatSession) {
    this.currentSession = session;
    this.sessionId = session.sessionId;
    this.showSessionList = false;
    await this.loadMessages(session.sessionId);
  }

  async createNewSession() {
    try {
      const session = await this.sdk.createSession();
      this.currentSession = session;
      this.sessionId = session.sessionId;
      this.messages = [];
      this.sessions.unshift(session);
    } catch (error) {
      console.error('创建会话失败:', error);
      promptAction.showToast({ message: '创建会话失败' });
    }
  }

  async deleteSession(sid: string) {
    try {
      await this.sdk.deleteSession(sid);
      if (this.currentSession?.sessionId === sid) {
        this.currentSession = null;
        this.sessionId = '';
        this.messages = [];
      }
      this.sessions = this.sessions.filter(s => s.sessionId !== sid);
      await this.loadSessionList();
    } catch (error) {
      console.error('删除会话失败:', error);
      promptAction.showToast({ message: '删除会话失败' });
    }
  }

  async loadMessages(sessionId: string, page: number = 1) {
    this.isLoadingHistory = true;
    try {
      const result = await this.sdk.getSessionMessages(sessionId, page, MESSAGE_PAGE_SIZE);
      if (page === 1) {
        this.messages = result.data ?? [];
      } else {
        this.messages = [...(result.data ?? []), ...this.messages];
      }
      this.hasMoreMessages = (result.data?.length ?? 0) >= MESSAGE_PAGE_SIZE;
      this.currentPage = page;
    } catch (error) {
      console.error('加载消息失败:', error);
    } finally {
      this.isLoadingHistory = false;
    }
  }

  async sendMessage() {
    if (this.isLoading || !this.inputValue.trim()) return;
    const content = this.inputValue.trim();
    this.inputValue = '';
    this.isLoading = true;
    this.isTyping = true;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: content,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      status: 'sending',
    };
    this.messages.push(userMessage);

    if (!this.sessionId) {
      try {
        const session = await this.sdk.createSession(content.substring(0, 30));
        this.sessionId = session.sessionId;
        this.currentSession = session;
        userMessage.sessionId = session.sessionId;
        this.sessions.unshift(session);
      } catch (error) {
        console.error('创建会话失败:', error);
      }
    }

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      status: 'sending',
    };
    this.messages.push(assistantMessage);

    try {
      await this.sdk.sendMessageStream(
        this.sessionId,
        content,
        (event: SSEMessage) => {
          if (event.event === 'message' || event.event === 'done') {
            const idx = this.messages.findIndex(m => m.id === assistantMessageId);
            if (idx >= 0) {
              this.messages[idx].content += event.data;
            }
          } else if (event.event === 'law_ref') {
            try {
              const ref = JSON.parse(event.data) as LawReference;
              const idx = this.messages.findIndex(m => m.id === assistantMessageId);
              if (idx >= 0) {
                if (!this.messages[idx].lawRefs) this.messages[idx].lawRefs = [];
                this.messages[idx].lawRefs.push(ref);
              }
            } catch (e) { console.error('解析法律引用失败:', e); }
          } else if (event.event === 'error') {
            promptAction.showToast({ message: event.data || '响应错误' });
          }
        }
      );
      const uIdx = this.messages.findIndex(m => m.id === userMessage.id);
      if (uIdx >= 0) this.messages[uIdx].status = 'sent';
      const aIdx = this.messages.findIndex(m => m.id === assistantMessageId);
      if (aIdx >= 0) this.messages[aIdx].status = 'sent';
    } catch (error) {
      console.error('发送失败:', error);
      const aIdx = this.messages.findIndex(m => m.id === assistantMessageId);
      if (aIdx >= 0) this.messages.splice(aIdx, 1);
      promptAction.showToast({ message: '发送失败，请稍后重试' });
    } finally {
      this.isLoading = false;
      this.isTyping = false;
    }
  }

  async loadMoreMessages() {
    if (!this.sessionId || this.isLoadingHistory || !this.hasMoreMessages) return;
    await this.loadMessages(this.sessionId, this.currentPage + 1);
  }

  build() {
    Column() {
      this.renderHeader()
      if (this.messages.length === 0 && !this.isLoadingHistory) {
        this.renderEmptyState()
      } else {
        this.renderMessageList()
      }
      this.renderInputArea()
    }
    .width('100%').height('100%').backgroundColor('#f5f5f5')
  }

  private renderHeader() {
    Row() {
      Button() {
        Image($r('app.media.menu')).width(20).height(20).fillColor('#333333')
      }
        .type(ButtonType.Circle).backgroundColor('#f5f5f5')
        .onClick(() => { this.showSessionList = !this.showSessionList; })
      Text(this.currentSession?.title || '法律智能体')
        .fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
        .textAlign(TextAlign.Center)
      Button() {
        Image($r('app.media.plus')).width(20).height(20).fillColor('#333333')
      }
        .type(ButtonType.Circle).backgroundColor('#f5f5f5')
        .onClick(async () => { await this.createNewSession(); })
    }
    .padding(16).backgroundColor('#ffffff')
    .shadow({ radius: 2, color: '#00000010', offsetY: 1 })
    if (this.showSessionList) { this.renderSessionList() }
  }

  private renderSessionList() {
    Stack() {
      Column().width('100%').height('100%').backgroundColor('#00000080')
        .onClick(() => { this.showSessionList = false; })
      Column() {
        Row() {
          Text('历史会话').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
          Button('关闭').fontSize(14).fontColor('#1890ff').backgroundColor('#ffffff')
            .onClick(() => { this.showSessionList = false; })
        }.width('100%').padding(16).backgroundColor('#ffffff')
        if (this.sessions.length === 0) {
          Text('暂无历史会话').fontSize(14).fontColor('#999999').width('100%')
            .textAlign(TextAlign.Center).padding(32)
        } else {
          List({ space: 0 }) {
            ForEach(this.sessions, (session: ChatSession) => {
              ListItem() {
                Row() {
                  Column() {
                    Text(session.title || '新对话').fontSize(15).fontColor('#333333')
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(formatRelativeTime(session.updatedAt)).fontSize(12).fontColor('#999999').margin({ top: 4 })
                  }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                  Button() {
                    Image($r('app.media.delete')).width(16).height(16).fillColor('#ff4d4f')
                  }.type(ButtonType.Circle).backgroundColor('#fff2f0').margin({ left: 8 })
                    .onClick((e: Event) => { e.stopPropagation(); this.deleteSession(session.sessionId); })
                }.width('100%').padding(16)
                  .backgroundColor(session.sessionId === this.sessionId ? '#e6f7ff' : '#ffffff')
                  .onClick(async () => { await this.switchSession(session); })
                Divider().color('#f0f0f0').width('80%').margin({ left: 16 })
              }
            }, (session: ChatSession) => session.sessionId)
          }.layoutWeight(1)
        }
      }.width('75%').height('100%').backgroundColor('#ffffff')
        .shadow({ radius: 4, color: '#00000020', offsetX: 4 })
    }.width('100%').height('100%')
  }

  private renderEmptyState() {
    Column() {
      Image($r('app.media.robot_avatar')).width(80).height(80).margin({ top: 60 })
      Text('法律智能体').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#333333').margin({ top: 16 })
      Text('您好！我是您的AI法律助手').fontSize(14).fontColor('#666666').margin({ top: 8 })
      Text('我可以帮您解答法律问题、分析案件、检索法律法规').fontSize(13).fontColor('#999999').margin({ top: 8 })
      Column() {
        Text('您可以问我：').fontSize(14).fontWeight(FontWeight.Medium).fontColor('#333333')
          .alignSelf(ItemAlign.Start).margin({ bottom: 12 })
        Wrap() {
          ForEach(['劳动合同纠纷怎么处理？','离婚财产如何分割？','交通事故赔偿标准是什么？','借款不还该怎么办？'], (q: string) => {
            Button(q).fontSize(12).fontColor('#1890ff').backgroundColor('#e6f7ff').borderRadius(16)
              .padding({ left: 12, right: 12, top: 8, bottom: 8 }).margin({ right: 8, bottom: 8 })
              .onClick(() => { this.inputValue = q; })
          })
        }
      }.width('100%').padding(24).margin({ top: 40 }).backgroundColor('#ffffff').borderRadius(12)
        .shadow({ radius: 4, color: '#00000010', offsetY: 2 }).layoutWeight(1)
    }.width('100%').layoutWeight(1).padding({ top: 16 })
  }

  private renderMessageList() {
    List({ space: 12 }) {
      if (this.isLoadingHistory) {
        ListItem() { LoadingSpinner { size: 24; text: '加载中...'; }.width('100%') }
      }
      ForEach(this.messages, (message: ChatMessage) => {
        ListItem() { MessageBubble({ message: message, isUser: message.role === 'user' }) }
      }, (message: ChatMessage) => message.id)
    }.layoutWeight(1).padding({ left: 16, right: 16, top: 12 }).backgroundColor('#f5f5f5')
      .onReachEnd(() => { this.loadMoreMessages(); })
  }

  private renderInputArea() {
    Column() {
      Row() {
        Button() { Image($r('app.media.image')).width(22).height(22).fillColor('#666666') }
          .type(ButtonType.Circle).backgroundColor('#f5f5f5').margin({ right: 8 })
          .onClick(() => { promptAction.showToast({ message: '图片上传功能开发中' }); })
        Button() { Image($r('app.media.voice')).width(22).height(22).fillColor('#666666') }
          .type(ButtonType.Circle).backgroundColor('#f5f5f5')
          .onClick(() => { promptAction.showToast({ message: '语音输入功能开发中' }); })
      }.padding({ bottom: 8 })
      Row() {
        TextInput({ placeholder: '输入您的问题...', text: this.inputValue })
          .onChange((value: string) => { this.inputValue = value; })
          .height(44).flex(1).margin({ right: 8 }).borderRadius(22).backgroundColor('#ffffff')
          .padding({ left: 16, right: 16 }).fontSize(15)
        if (this.isLoading) {
          LoadingProgress().width(44).height(44).color('#1890ff')
        } else {
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.send')).width(22).height(22).fillColor('#ffffff')
          }.width(44).height(44).backgroundColor(this.inputValue.trim().length > 0 ? '#1890ff' : '#cccccc')
            .enabled(this.inputValue.trim().length > 0)
            .onClick(() => { this.sendMessage(); })
        }
      }.padding(12).backgroundColor('#ffffff')
        .shadow({ radius: 4, color: '#0000001a', offsetY: -2 })
    }.width('100%')
  }
}
