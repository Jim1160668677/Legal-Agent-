﻿/**
 * 搜索栏组件
 */
@Component
export struct SearchBar {
  @Prop placeholder: string = '搜索...';
  @Link query: string;
  @Prop showCancel: boolean = false;
  @Action onSearch?: (query: string) => void;
  @Action onCancel?: () => void;
  @Action onSubmit?: (query: string) => void;

  build() {
    Row() {
      Image($r('app.media.search'))
        .width(18)
        .height(18)
        .fillColor('#999999')
        .margin({ right: 8 })

      TextInput({ placeholder: this.placeholder, text: this.query })
        .onChange((value: string) => {
          this.query = value;
        })
        .onSubmit((value: string) => {
          this.onSubmit?.(value);
        })
        .height(36)
        .flex(1)
        .backgroundColor('#f5f5f5')
        .borderRadius(18)
        .padding({ left: 8, right: 8 })
        .fontSize(14)
        .fontColor('#333333')
        .placeholderColor('#999999')

      if (this.showCancel) {
        Text('取消')
          .fontSize(14)
          .fontColor('#1890ff')
          .margin({ left: 12 })
          .onClick(() => {
            this.query = '';
            this.onCancel?.();
          })
      }
    }
    .width('100%')
    .height(44)
    .padding({ left: 16, right: 16 })
    .backgroundColor('#ffffff')
  }
}
