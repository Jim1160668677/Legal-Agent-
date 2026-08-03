﻿/**
 * 加载指示器组件
 */
@Component
export struct LoadingSpinner {
  @Prop size: number = 40;
  @Prop color: string = '#1890ff';
  @Prop text: string = '加载中...';

  build() {
    Column() {
      LoadingProgress()
        .width(this.size)
        .height(this.size)
        .color(this.color)
        .margin({ bottom: 12 })

      if (this.text) {
        Text(this.text)
          .fontSize(14)
          .fontColor('#999999')
      }
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding(20)
  }
}

@Component
export struct SkeletonLoader {
  @Prop lines: number = 3;
  @Prop hasNext: boolean = false;

  build() {
    Column() {
      ForEach(Array.from({ length: this.lines }), (_item: unknown, index: number) => {
        Column() {
          Rect()
            .width('90%')
            .height(16)
            .fillColor('#e8e8e8')
            .borderRadius(4)
            .margin({ bottom: index < this.lines - 1 ? 12 : 0 })
            .animation({
              duration: 1000,
              iterations: -1,
              direction: AnimationDirection.ALTERNATE,
              playMode: AnimationPlayMode.NORMAL
            })
            .opacity(0.5)
        }
        .width('100%')
        .padding({ left: 16, right: 16 })
      }, (_item: unknown, index: number) => index.toString())
    }
    .width('100%')
  }
}
