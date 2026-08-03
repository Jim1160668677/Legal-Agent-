﻿/**
 * 消息气泡组件
 */
import { ChatMessage, LawReference } from '../models/ChatMessage';
import { formatTime } from '../utils/DateUtil';

@Component
export struct MessageBubble {
  @Prop message: ChatMessage;
  @Prop isUser: boolean = false;

  build() {
    Row() {
      if (!this.isUser) {
        Image($r('app.media.robot_avatar'))
          .width(36)
          .height(36)
          .borderRadius(18)
          .margin({ right: 8 })
      }

      Column() {
        Text(this.message.content)
          .fontSize(16)
          .fontColor(this.isUser ? '#ffffff' : '#333333')
          .padding(12)
          .backgroundColor(this.isUser ? '#1890ff' : '#ffffff')
          .borderRadius(this.isUser ? 16 : 16)
          .maxWidth(this.isUser ? 300 : 320)
          .textAlign(this.isUser ? TextAlign.Right : TextAlign.Left)
          .lineHeight(24)

        if (this.message.lawRefs && this.message.lawRefs.length > 0 && !this.isUser) {
          Wrap() {
            ForEach(this.message.lawRefs, (ref: LawReference) => {
              Text(ref.title)
                .fontSize(11)
                .fontColor('#1890ff')
                .backgroundColor('#e6f7ff')
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .borderRadius(4)
                .margin({ right: 4, top: 4 })
            }, (ref: LawReference) => ref.id)
          }
          .margin({ top: 8 })
        }

        Text(formatTime(this.message.timestamp))
          .fontSize(11)
          .fontColor('#999999')
          .margin({ top: 4 })
          .alignSelf(this.isUser ? ItemAlign.End : ItemAlign.Start)
      }
      .alignSelf(this.isUser ? ItemAlign.End : ItemAlign.Start)

      if (this.isUser) {
        Image($r('app.media.user_avatar'))
          .width(36)
          .height(36)
          .borderRadius(18)
          .margin({ left: 8 })
      }
    }
    .width('100%')
    .justifyContent(this.isUser ? FlexAlign.End : FlexAlign.Start)
    .padding({ top: 8, bottom: 8 })
  }
}
