/**
 * HarmonyOS鸿蒙 - 首页
 */
import { router } from '@kit.ArkUI';
import { LegalAgentSDK } from '../sdk/LegalAgentSDK';
import { isLoggedIn, getUserInfo } from '../utils/Storage';
import { User } from '../models/User';
import { ChatPage as ChatPageImpl } from './chat/Chat';
import { AnalysisPage as AnalysisPageImpl } from './analysis/Analysis';
import { KnowledgePage } from './knowledge/Knowledge';
import { ProfilePage } from './profile/Profile';

@Entry
@Component
struct Index {
  @State isLogin: boolean = false;
  @State currentTab: number = 0;
  @State userData: User | null = null;
  @State isLoading: boolean = true;
  private sdk: LegalAgentSDK = new LegalAgentSDK();

  aboutToAppear() {
    this.checkLoginStatus();
  }

  async checkLoginStatus() {
    this.isLoading = true;
    try {
      const loggedIn = await isLoggedIn();
      if (loggedIn) {
        this.isLogin = true;
        this.userData = await getUserInfo();
      } else {
        this.isLogin = false;
      }
    } catch (error) {
      console.error('检查登录状态失败:', error);
      this.isLogin = false;
    } finally {
      this.isLoading = false;
    }
  }

  build() {
    Stack() {
      if (this.isLoading) {
        Column() {
          LoadingProgress().width(48).height(48).color('#1890ff')
          Text('加载中...').fontSize(14).fontColor('#999999').margin({ top: 16 })
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#ffffff')
      } else if (this.isLogin) {
        Tabs({ barPosition: BarPosition.End }) {
          TabContent() { ChatPageImpl() }.tabBar(this.tabIcon(0, '对话', 'message'))
          TabContent() { AnalysisPageImpl() }.tabBar(this.tabIcon(1, '分析', 'analysis'))
          TabContent() { KnowledgePage() }.tabBar(this.tabIcon(2, '知识', 'book'))
          TabContent() { ProfilePage() }.tabBar(this.tabIcon(3, '我的', 'user'))
        }.verticalLine(false).barHeight(80).onChange((index: number) => { this.currentTab = index; })
      } else {
        LoginView({ onLoginSuccess: () => { this.checkLoginStatus(); } })
      }
    }.width('100%').height('100%')
  }

  tabIcon(index: number, text: string, icon: string): VBag {
    return () => {
      Column() {
        Image($r(`app.media.${icon}`)).width(24).height(24).fillColor(index === this.currentTab ? '#1890ff' : '#999999')
        Text(text).fontSize(12).fontColor(index === this.currentTab ? '#1890ff' : '#999999').margin({ top: 4 })
      }.alignItems(HorizontalAlign.Center).width('100%').height(60)
    }
  }
}

@Component
struct LoginView {
  @State username: string = '';
  @State password: string = '';
  @State loading: boolean = false;
  @Prop onLoginSuccess?: () => void;
  private sdk: LegalAgentSDK = new LegalAgentSDK();

  build() {
    Scroll() {
      Column() {
        Column() {
          Stack() {
            Circle().width(100).height(100).fillColor('#1890ff')
            Image($r('app.media.logo')).width(60).height(60).fillColor('#ffffff')
          }
          Text('法律智能体').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#333333').margin({ top: 20 })
          Text('您的AI法律助手').fontSize(14).fontColor('#999999').margin({ top: 8 })
        }.width('100%').padding({ top: 80, bottom: 40 }).justifyContent(FlexAlign.Center).backgroundColor('#ffffff')

        Column() {
          Text('登录').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#333333').alignSelf(ItemAlign.Start).margin({ bottom: 24 })

          Column() {
            Text('用户名').fontSize(14).fontColor('#666666').alignSelf(ItemAlign.Start).margin({ bottom: 8 })
            TextInput({ placeholder: '请输入用户名', text: this.username })
              .width('100%').height(48).borderRadius(8).backgroundColor('#f5f5f5').fontSize(15)
              .onChange((value: string) => { this.username = value; })
          }.width('100%').margin({ bottom: 16 })

          Column() {
            Text('密码').fontSize(14).fontColor('#666666').alignSelf(ItemAlign.Start).margin({ bottom: 8 })
            TextInput({ placeholder: '请输入密码', text: this.password, type: InputType.Password })
              .width('100%').height(48).borderRadius(8).backgroundColor('#f5f5f5').fontSize(15)
              .onChange((value: string) => { this.password = value; })
          }.width('100%').margin({ bottom: 24 })

          Row() {
            Checkbox({ name: 'remember' }).width(18).height(18).select(false).onChange((selected: boolean) => { })
            Text('记住密码').fontSize(14).fontColor('#666666').margin({ left: 8 })
            Blank()
            Text('忘记密码?').fontSize(14).fontColor('#1890ff')
              .onClick(() => { promptAction.showToast({ message: '请联系管理员重置密码' }); })
          }.width('100%').margin({ bottom: 32 })

          Button(this.loading ? '登录中...' : '登录')
            .width('100%').height(48).fontSize(16).fontWeight(FontWeight.Medium)
            .backgroundColor(this.username.trim().length > 0 && this.password.trim().length > 0 && !this.loading ? '#1890ff' : '#cccccc')
            .enabled(this.username.trim().length > 0 && this.password.trim().length > 0 && !this.loading)
            .borderRadius(8)
            .onClick(async () => {
              if (this.loading) return;
              this.loading = true;
              try {
                const result = await this.sdk.login(this.username, this.password);
                promptAction.showToast({ message: '登录成功', duration: 1500 });
                this.onLoginSuccess?.();
              } catch (error) {
                console.error('登录失败:', error);
                promptAction.showToast({ message: '登录失败，请检查用户名和密码', duration: 2000 });
              } finally {
                this.loading = false;
              }
            }).margin({ bottom: 16 })

          Row() {
            Text('还没有账号?').fontSize(14).fontColor('#999999')
            Text('立即注册').fontSize(14).fontColor('#1890ff').margin({ left: 4 })
          }.width('100%').justifyContent(FlexAlign.Center)
            .onClick(() => { promptAction.showToast({ message: '注册功能开发中' }); })
        }.width('100%').padding(24).backgroundColor('#ffffff').borderRadius({ topLeft: 24, topRight: 24 })
          .shadow({ radius: 8, color: '#00000010', offsetY: 4 })
      }.width('100%').backgroundColor('#f5f5f5')
    }.width('100%').height('100%')
  }
}
