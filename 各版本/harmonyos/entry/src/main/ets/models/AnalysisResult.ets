/**
 * 案件分析结果模型
 */
export interface IRACAnalysis {
  issue: string[];
  rule: LegalRule[];
  analysis: string[];
  conclusion: string;
}

export interface LegalRule {
  law: string;
  article: string;
  content: string;
}

export interface RiskAssessment {
  level: 'high' | 'medium' | 'low';
  levelText: string;
  factors: RiskFactor[];
  suggestions: string[];
}

export interface RiskFactor {
  name: string;
  impact: 'high' | 'medium' | 'low';
  description: string;
}

export interface CaseRecommendation {
  id: string;
  type: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AnalysisResult {
  analysisId: string;
  caseType: string;
  caseTypeText: string;
  createdAt: number;
  irac: IRACAnalysis;
  riskAssessment: RiskAssessment;
  recommendations: CaseRecommendation[];
}

export interface AnalysisRequest {
  caseType: string;
  facts: string;
  requirements?: string;
}

export interface CaseTypeOption {
  id: string;
  name: string;
  icon: string;
  description?: string;
}
