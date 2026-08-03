﻿/**
 * 个人中心页面
 */
import { router } from '@kit.ArkUI';
import { LegalAgentSDK } from '../../sdk/LegalAgentSDK';
import { getUserInfo, clearAuth, isLoggedIn } from '../../utils/Storage';
import { User } from '../../models/User';
import { formatRelativeTime } from '../../utils/DateUtil';

@Entry
@Component
struct ProfilePage {
  @State user: User | null = null;
  @State isLoading: boolean = true;
  private sdk: LegalAgentSDK = new LegalAgentSDK();

  aboutToAppear() {
    this.loadUserInfo();
  }

  async loadUserInfo() {
    this.isLoading = true;
    try {
      this.user = await getUserInfo();
    } catch (error) {
      console.error('获取用户信息失败:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async handleLogout() {
    try {
      if (this.sdk.getToken()) {
        await this.sdk.logout();
      }
    } catch (error) {
      console.error('登出失败:', error);
    } finally {
      await clearAuth();
      router.replaceUrl({ url: 'pages/index/index' });
    }
  }

  build() {
    Column() {
      this.renderUserInfo()
      this.renderQuickActions()
      this.renderSettings()
      this.renderLogoutButton()
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f5f5f5')
  }

  private renderUserInfo() {
    Column() {
      if (this.isLoading) {
        LoadingProgress().width(40).height(40).color('#1890ff')
      } else if (this.user) {
        Row() {
          Image(this.user.avatar ? this.user.avatar : $r('app.media.default_avatar'))
            .width(64).height(64).borderRadius(32).backgroundColor('#e8e8e8')
          Column() {
            Text(this.user.nickname || this.user.username).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#333333')
            Text(this.getUserRoleText(this.user.role)).fontSize(12).fontColor('#999999').margin({ top: 4 })
            if (this.user.lastLoginAt) {
              Text('上次登录: ' + formatRelativeTime(this.user.lastLoginAt)).fontSize(11).fontColor('#cccccc').margin({ top: 4 })
            }
          }
          .alignItems(HorizontalAlign.Start).layoutWeight(1).margin({ left: 16 })
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.edit')).width(18).height(18).fillColor('#1890ff')
          }
            .onClick(() => { router.pushUrl({ url: 'pages/profile/edit' }); })
        }
        .width('100%').padding(24).backgroundColor('#ffffff')
      } else {
        Column() {
          Image($r('app.media.default_avatar')).width(64).height(64).borderRadius(32).backgroundColor('#e8e8e8')
          Text('登录/注册').fontSize(18).fontWeight(FontWeight.Medium).fontColor('#333333').margin({ top: 16 })
          Text('登录后享受更多服务').fontSize(14).fontColor('#999999').margin({ top: 8 })
          Button('立即登录').width(200).height(44).fontSize(16).backgroundColor('#1890ff').margin({ top: 24 })
            .onClick(async () => {
              const logged = await isLoggedIn();
              if (!logged) { router.pushUrl({ url: 'pages/index/index' }); }
            })
        }
        .width('100%').padding(24).backgroundColor('#ffffff').justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
  }

  private renderQuickActions() {
    Column() {
      Text('快捷功能').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#333333')
        .alignSelf(ItemAlign.Start).padding({ left: 16, top: 16, bottom: 12 })
      Grid() {
        ForEach([
          { icon: 'chat', name: '历史对话', color: '#1890ff' },
          { icon: 'analysis', name: '案件分析', color: '#52c41a' },
          { icon: 'search', name: '搜索历史', color: '#faad14' },
          { icon: 'star', name: '我的收藏', color: '#eb2f96' },
          { icon: 'bookmark', name: '收藏案例', color: '#722ed1' },
          { icon: 'download', name: '我的下载', color: '#13c2c2' },
        ], (item: { icon: string, name: string, color: string }) => {
          GridItem() {
            Column() {
              Stack() {
                Circle().width(44).height(44).fillColor(item.color + '15')
                Image($r('app.media.' + item.icon)).width(24).height(24).fillColor(item.color)
              }
              Text(item.name).fontSize(12).fontColor('#666666').margin({ top: 8 })
            }
            .width('100%').height(80).justifyContent(FlexAlign.Center)
          }
            .backgroundColor('#ffffff').borderRadius(12).shadow({ radius: 2, color: '#00000010', offsetY: 1 })
        })
      }
      .columnsTemplate('1fr 1fr 1fr').columnsGap(12).rowsGap(12).padding(16).width('100%').backgroundColor('#ffffff').margin({ top: 8 })
    }
    .width('100%')
  }

  private renderSettings() {
    Column() {
      Text('设置').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#333333')
        .alignSelf(ItemAlign.Start).padding({ left: 16, top: 16, bottom: 12 })
      Column() {
        ForEach([
          { icon: 'bell', name: '消息通知', desc: '开启消息推送' },
          { icon: 'lock', name: '账号安全', desc: '密码、绑定手机' },
          { icon: 'eye', name: '隐私设置', desc: '隐私权限管理' },
          { icon: 'info', name: '关于我们', desc: '版本信息' },
          { icon: 'help', name: '帮助与反馈', desc: '常见问题' },
        ], (item: { icon: string, name: string, desc: string }) => {
          Column() {
            Row() {
              Image($r('app.media.' + item.icon)).width(20).height(20).fillColor('#666666').margin({ right: 12 })
              Column() {
                Text(item.name).fontSize(15).fontColor('#333333')
                Text(item.desc).fontSize(12).fontColor('#999999').margin({ top: 2 })
              }
              .alignItems(HorizontalAlign.Start).layoutWeight(1)
              Image($r('app.media.arrow_right')).width(16).height(16).fillColor('#cccccc')
            }
            .width('100%').padding(16)
            .onClick(() => { promptAction.showToast({ message: item.name + '功能开发中' }); })
            Divider().color('#f0f0f0').width('90%').margin({ left: 48 })
          }
        })
      }
      .width('100%').backgroundColor('#ffffff').margin({ top: 8 })
    }
    .width('100%')
  }

  private renderLogoutButton() {
    Column() {
      Button('退出登录')
        .width('80%').height(48).fontSize(16).fontColor('#ff4d4f')
        .backgroundColor('#ffffff').border({ width: 1, color: '#ff4d4f' }).borderRadius(24)
        .margin({ top: 32 })
        .onClick(() => {
          promptAction.showDialog({
            title: '确认退出',
            message: '确定要退出登录吗？',
            buttons: [
              { text: '取消', color: '#666666' },
              { text: '退出', color: '#ff4d4f', onClick: () => { this.handleLogout(); } }
            ]
          });
        })
    }
    .width('100%').padding(32).backgroundColor('#f5f5f5')
  }

  private getUserRoleText(role: string): string {
    switch (role) {
      case 'user': return '普通用户';
      case 'lawyer': return '执业律师';
      case 'admin': return '管理员';
      default: return '用户';
    }
  }
}
