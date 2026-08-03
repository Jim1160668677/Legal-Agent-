/**
 * HarmonyOS - 案件分析页面
 */
import { router } from '@kit.ArkUI';
import { LegalAgentSDK } from '../sdk/LegalAgentSDK';
import { CaseTypeOption, AnalysisRequest } from '../models/AnalysisResult';
import { CaseTypeSelector } from '../components/CaseTypeSelector';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface AnalysisResultData {
  analysisId: string;
  caseType: string;
  caseTypeText: string;
  createdAt: number;
  irac: {
    issue: string[];
    rule: any[];
    analysis: any[];
    conclusion: string;
  };
  riskAssessment: {
    level: 'high' | 'medium' | 'low';
    levelText: string;
    factors: any[];
    suggestions: string[];
  };
  recommendations: any[];
}

@Entry
@Component
struct AnalysisPage {
  @State caseTypes: CaseTypeOption[] = [
    { id: 'contract', name: '合同纠纷', icon: 'document' },
    { id: 'labor', name: '劳动争议', icon: 'user' },
    { id: 'property', name: '房产纠纷', icon: 'home' },
    { id: 'marriage', name: '婚姻家庭', icon: 'people' },
    { id: 'tort', name: '侵权纠纷', icon: 'warning' },
    { id: 'criminal', name: '刑事案件', icon: 'lock' },
  ];

  @State selectedCaseType: string = 'contract';
  @State factsText: string = '';
  @State requirementsText: string = '';
  @State isLoading: boolean = false;
  @State result: AnalysisResultData | null = null;
  @State showError: boolean = false;

  private sdk: LegalAgentSDK = new LegalAgentSDK();

  async submitAnalysis() {
    if (this.isLoading || this.factsText.length < 50) return;
    this.isLoading = true;
    this.result = null;
    this.showError = false;
    try {
      const requestData: AnalysisRequest = {
        caseType: this.selectedCaseType,
        facts: this.factsText,
        requirements: this.requirementsText,
      };
      const response = await this.sdk.analyzeCase(requestData);
      this.result = {
        analysisId: response.analysisId,
        caseType: response.caseType,
        caseTypeText: response.caseTypeText,
        createdAt: response.createdAt,
        irac: response.irac,
        riskAssessment: response.riskAssessment,
        recommendations: response.recommendations,
      };
    } catch (error) {
      console.error('分析失败:', error);
      this.showError = true;
    } finally {
      this.isLoading = false;
    }
  }

  build() {
    Column() {
      Row() {
        Text('案件分析').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.history')).width(20).height(20)
        }.visible(false)
      }.padding(16).backgroundColor('#ffffff')

      Scroll() {
        Column() {
          CaseTypeSelector({
            types: this.caseTypes,
            selectedType: $this.selectedCaseType,
            onSelect: (typeId: string) => { this.selectedCaseType = typeId; }
          })
          Divider().margin({ top: 16, bottom: 16 })

          Text('案件事实').fontSize(14).fontColor('#666666').margin({ bottom: 8 }).alignSelf(ItemAlign.Start)
          TextArea({ text: this.factsText, placeholder: '请详细描述案件情况...\n建议至少50字', maxlength: 2000 })
            .height(200).width('100%').borderRadius(8).backgroundColor('#f5f5f5')
            .onChange((value: string) => { this.factsText = value; })
          Text(this.factsText.length + '/2000').fontSize(12).fontColor('#999999').alignSelf(ItemAlign.End).margin({ top: 4 })

          Text('您的诉求（可选）').fontSize(14).fontColor('#666666').margin({ top: 16, bottom: 8 }).alignSelf(ItemAlign.Start)
          TextArea({ text: this.requirementsText, placeholder: '您希望通过法律途径达到什么目的？' })
            .height(100).width('100%').borderRadius(8).backgroundColor('#f5f5f5')
            .onChange((value: string) => { this.requirementsText = value; })

          Button(this.isLoading ? '分析中...' : '开始分析')
            .width('100%').height(48).fontSize(16).fontWeight(FontWeight.Medium)
            .backgroundColor(this.factsText.length >= 50 && !this.isLoading ? '#1890ff' : '#cccccc')
            .enabled(this.factsText.length >= 50 && !this.isLoading)
            .onClick(() => { this.submitAnalysis(); }).margin({ top: 24 })

          if (this.isLoading) {
            Row() {
              LoadingProgress().color('#1890ff').margin({ right: 12 })
              Text('AI正在分析案件中，请稍候...').fontSize(14).fontColor('#666666')
            }.width('100%').justifyContent(FlexAlign.Center).padding(16).margin({ top: 16 })
              .backgroundColor('#f0f7ff').borderRadius(8)
          }

          if (this.result) { this.renderResult(); }
          if (this.showError) {
            Row() {
              Image($r('app.media.error')).width(20).height(20).margin({ right: 8 })
              Text('分析失败，请稍后重试').fontSize(14).fontColor('#ff4d4f')
              Blank()
              Button('重试').fontColor('#ff4d4f').onClick(() => { this.showError = false; this.submitAnalysis(); })
            }.width('100%').padding(16).backgroundColor('#fff2f0').borderRadius(8).margin({ top: 16 })
          }
          Blank().height(32)
        }.width('100%').padding(16)
      }.layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#f5f5f5')
  }

  private renderResult() {
    if (!this.result) return;
    Column() {
      Row() {
        Text('风险等级').fontSize(14).fontColor('#666666').margin({ right: 12 })
        Text(this.getRiskLevelText(this.result.riskAssessment.level)).fontSize(14)
          .fontColor(this.getRiskColor(this.result.riskAssessment.level))
          .padding({ left: 12, right: 12, top: 4, bottom: 4 })
          .backgroundColor(this.getRiskBgColor(this.result.riskAssessment.level)).borderRadius(12)
      }.width('100%').justifyContent(FlexAlign.Start).margin({ bottom: 16 })
      this.renderSection('争议焦点', this.result.irac.issue)
      if (this.result.irac.rule.length > 0) {
        this.renderSection('法律依据', this.result.irac.rule.map((r: any) => r.law + ' - ' + r.article))
      }
      this.renderSection('分析结论', [this.result.irac.conclusion])
      if (this.result.recommendations.length > 0) {
        this.renderSection('专业建议', this.result.recommendations.map((r: any) => r.content))
      }
    }.width('100%').padding(16).backgroundColor('#ffffff').borderRadius(12).margin({ top: 16 })
      .shadow({ radius: 4, color: '#0000001a', offsetY: 2 })
  }

  private renderSection(title: string, items: string[]) {
    Column() {
      Text(title).fontSize(15).fontWeight(FontWeight.Medium).fontColor('#333333').margin({ bottom: 8 }).alignSelf(ItemAlign.Start)
      ForEach(items, (item: string, index: number) => {
        Row() {
          Text((index + 1) + '.').fontSize(14).fontColor('#1890ff').margin({ right: 8 })
          Text(item).fontSize(14).fontColor('#333333').layoutWeight(1)
        }.width('100%').margin({ bottom: 8 })
      })
    }.width('100%').padding(12).backgroundColor('#f8f9fa').borderRadius(8).margin({ bottom: 16 })
  }

  private getRiskLevelText(level: string): string {
    switch (level) {
      case 'high': return '高风险';
      case 'medium': return '中风险';
      case 'low': return '低风险';
      default: return '未知';
    }
  }

  private getRiskColor(level: string): string {
    switch (level) {
      case 'high': return '#ff4d4f';
      case 'medium': return '#faad14';
      case 'low': return '#52c41a';
      default: return '#999999';
    }
  }

  private getRiskBgColor(level: string): string {
    switch (level) {
      case 'high': return '#fff2f0';
      case 'medium': return '#fff7e6';
      case 'low': return '#f6ffed';
      default: return '#fafafa';
    }
  }
}
