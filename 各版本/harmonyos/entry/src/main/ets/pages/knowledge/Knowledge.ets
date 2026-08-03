﻿/**
 * 法律知识检索页面
 */
import { router } from '@kit.ArkUI';
import { LegalAgentSDK } from '../../sdk/LegalAgentSDK';
import { SearchBar } from '../../components/SearchBar';
import { LoadingSpinner, SkeletonLoader } from '../../components/LoadingSpinner';
import {
  KnowledgeItem,
  KnowledgeCategory,
  HotSearchWord,
  KnowledgeType
} from '../../models/KnowledgeResult';
import { KNOWLEDGE_DEFAULT_TOP_K } from '../../utils/Constants';

@Entry
@Component
struct KnowledgePage {
  @State query: string = '';
  @State results: KnowledgeItem[] = [];
  @State hotWords: HotSearchWord[] = [];
  @State categories: KnowledgeCategory[] = [];
  @State selectedCategory: string = 'all';
  @State isLoading: boolean = false;
  @State isSearching: boolean = false;
  @State selectedResult: KnowledgeItem | null = null;
  @State showResultDetail: boolean = false;

  private sdk: LegalAgentSDK = new LegalAgentSDK();

  aboutToAppear() {
    this.loadHotWords();
    this.loadCategories();
  }

  async loadHotWords() {
    this.hotWords = [
      { keyword: '劳动合同解除', count: 12580, category: 'law' },
      { keyword: '离婚财产分割', count: 9876, category: 'law' },
      { keyword: '交通事故赔偿', count: 8765, category: 'case' },
      { keyword: '劳动争议仲裁', count: 7654, category: 'regulation' },
      { keyword: '借款合同', count: 6543, category: 'law' },
      { keyword: '继承权纠纷', count: 5432, category: 'case' },
    ];
  }

  async loadCategories() {
    this.categories = [
      { id: 'all', name: '全部', type: 'law', icon: 'all', count: 12345 },
      { id: 'law', name: '法律法规', type: 'law', icon: 'book', count: 5678 },
      { id: 'regulation', name: '司法解释', type: 'regulation', icon: 'doc', count: 3456 },
      { id: 'case', name: '典型案例', type: 'case', icon: 'folder', count: 2345 },
      { id: 'interpretation', name: '政策解读', type: 'interpretation', icon: 'info', count: 1234 },
      { id: 'policy', name: '政策文件', type: 'policy', icon: 'file', count: 987 },
    ];
  }

  async searchKnowledge() {
    if (!this.query.trim()) return;
    this.isSearching = true;
    this.results = [];
    try {
      const response = await this.sdk.retrieveKnowledge(
        this.query,
        KNOWLEDGE_DEFAULT_TOP_K,
        this.selectedCategory === 'all' ? undefined : this.selectedCategory as KnowledgeType
      );
      if (response.success) {
        this.results = response.data ?? [];
      }
    } catch (error) {
      console.error('知识检索失败:', error);
      promptAction.showToast({ message: '检索失败，请稍后重试' });
    } finally {
      this.isSearching = false;
    }
  }

  build() {
    Column() {
      SearchBar({
        placeholder: '搜索法律法规、案例、司法解释...',
        query: $this.query,
        showCancel: false,
        onSubmit: (q: string) => {
          this.query = q;
          this.searchKnowledge();
        }
      })

      Row() {
        Scroll() {
          Row() {
            ForEach(this.categories, (cat: KnowledgeCategory) => {
              Button() {
                Row() {
                  Text(cat.name).fontSize(13)
                  Text(`${cat.count}`).fontSize(11).fontColor('#999999').margin({ left: 4 })
                }
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(this.selectedCategory === cat.id ? '#1890ff' : '#f5f5f5')
                .fontColor(this.selectedCategory === cat.id ? '#ffffff' : '#666666')
                .borderRadius(16)
              }
                .onClick(() => {
                  this.selectedCategory = cat.id;
                  if (this.query.trim()) { this.searchKnowledge(); }
                })
                .margin({ right: 8 })
            }, (cat: KnowledgeCategory) => cat.id)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollBar.Off)
        .layoutWeight(1)
      }
      .padding({ top: 8, bottom: 8 })
      .backgroundColor('#ffffff')

      if (this.query.trim() || this.selectedCategory !== 'all') {
        this.renderSearchResults()
      } else {
        this.renderHomeContent()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f5f5f5')
  }

  private renderHomeContent() {
    Scroll() {
      Column() {
        Column() {
          Row() {
            Text('热门搜索').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#333333')
            Blank()
            Text('更多').fontSize(12).fontColor('#1890ff')
          }
          .width('100%').padding({ left: 16, right: 16, top: 16, bottom: 12 })

          Wrap() {
            ForEach(this.hotWords, (word: HotSearchWord) => {
              Button() {
                Text(word.keyword).fontSize(13).fontColor('#333333')
                  .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                  .backgroundColor('#ffffff').borderRadius(16)
                  .shadow({ radius: 2, color: '#00000010', offsetY: 1 })
              }
                .onClick(() => { this.query = word.keyword; this.searchKnowledge(); })
                .margin({ right: 8, bottom: 8 })
            }, (word: HotSearchWord) => word.keyword)
          }
          .padding({ left: 16, right: 16, bottom: 16 })
        }
        .width('100%').backgroundColor('#ffffff').margin({ bottom: 8 })

        Column() {
          Text('快捷入口').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#333333')
            .alignSelf(ItemAlign.Start).padding({ left: 16, bottom: 12 })
          Grid() {
            ForEach([
              { icon: 'law', name: '法律法规', color: '#1890ff' },
              { icon: 'case', name: '典型案例', color: '#52c41a' },
              { icon: 'regulation', name: '司法解释', color: '#faad14' },
              { icon: 'policy', name: '政策文件', color: '#722ed1' },
            ], (item: { icon: string, name: string, color: string }) => {
              GridItem() {
                Column() {
                  Image($r(`app.media.${item.icon}`)).width(32).height(32).fillColor(item.color)
                  Text(item.name).fontSize(12).fontColor('#666666').margin({ top: 8 })
                }
                .width('100%').height(80).justifyContent(FlexAlign.Center)
              }
                .backgroundColor('#ffffff').borderRadius(12)
                .shadow({ radius: 2, color: '#00000010', offsetY: 1 })
            })
          }
          .columnsTemplate('1fr 1fr 1fr 1fr').columnsGap(12).rowsGap(12).padding(16)
        }
        .width('100%').backgroundColor('#ffffff').margin({ bottom: 8 })
      }
      .paddingBottom(32)
    }
    .layoutWeight(1)
  }

  private renderSearchResults() {
    Column() {
      if (this.isSearching) {
        SkeletonLoader { lines: 5 }
      } else if (this.results.length > 0) {
        List({ space: 8 }) {
          ForEach(this.results, (item: KnowledgeItem) => {
            ListItem() { this.renderKnowledgeItem(item) }
          }, (item: KnowledgeItem) => item.id)
        }
        .layoutWeight(1).padding(16)
      } else if (!this.isSearching && this.query.trim()) {
        Column() {
          Image($r('app.media.empty')).width(64).height(64).opacity(0.5)
          Text('暂无搜索结果').fontSize(14).fontColor('#999999').margin({ top: 12 })
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      }
    }
    .layoutWeight(1).backgroundColor('#f5f5f5')
  }

  private renderKnowledgeItem(item: KnowledgeItem) {
    Column() {
      Row() {
        Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#333333')
          .layoutWeight(1).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.getCategoryText(item.type)).fontSize(11).fontColor('#ffffff')
          .backgroundColor(this.getCategoryColor(item.type)).padding({ left: 8, right: 8, top: 2, bottom: 2 }).borderRadius(4)
          .margin({ left: 8 })
      }
      .width('100%')
      Text(item.content).fontSize(13).fontColor('#666666').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).margin({ top: 8 }).lineHeight(20)
      Row() {
        Text(item.source).fontSize(11).fontColor('#999999')
        Blank()
        Text(`${Math.round(item.relevanceScore * 100)}% 相关`).fontSize(11).fontColor('#1890ff')
      }
      .width('100%').margin({ top: 8 })
    }
    .width('100%').padding(16).backgroundColor('#ffffff').borderRadius(8)
      .onClick(() => { this.selectedResult = item; this.showResultDetail = true; })
      .shadow({ radius: 2, color: '#00000010', offsetY: 1 }).margin({ bottom: 8 })
  }

  private getCategoryText(type: KnowledgeType): string {
    switch (type) {
      case 'law': return '法律法规';
      case 'regulation': return '司法解释';
      case 'case': return '典型案例';
      case 'interpretation': return '政策解读';
      case 'policy': return '政策文件';
      default: return '其他';
    }
  }

  private getCategoryColor(type: KnowledgeType): string {
    switch (type) {
      case 'law': return '#1890ff';
      case 'regulation': return '#faad14';
      case 'case': return '#52c41a';
      case 'interpretation': return '#722ed1';
      case 'policy': return '#eb2f96';
      default: return '#999999';
    }
  }
}
