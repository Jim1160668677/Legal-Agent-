﻿/**
 * 案件类型选择器组件
 */
import { CaseTypeOption } from '../models/AnalysisResult';

@Component
export struct CaseTypeSelector {
  @Prop types: CaseTypeOption[] = [];
  @Link selectedType: string;
  @Action onSelect?: (typeId: string) => void;

  build() {
    Column() {
      Text('案件类型')
        .fontSize(14)
        .fontColor('#666666')
        .margin({ bottom: 12 })
        .alignSelf(ItemAlign.Start)

      Wrap() {
        ForEach(this.types, (item: CaseTypeOption) => {
          Button() {
            Row() {
              Text(item.name)
                .fontSize(14)
            }
            .padding({ left: 16, right: 16, top: 8, bottom: 8 })
            .backgroundColor(item.id === this.selectedType ? '#1890ff' : '#f5f5f5')
            .fontColor(item.id === this.selectedType ? '#ffffff' : '#333333')
            .borderRadius(20)
          }
            .onClick(() => {
              this.selectedType = item.id;
              this.onSelect?.(item.id);
            })
            .margin({ right: 10, bottom: 10 })
        }, (item: CaseTypeOption) => item.id)
      }
    }
    .width('100%')
  }
}
