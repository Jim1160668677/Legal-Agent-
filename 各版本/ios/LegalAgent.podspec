# legal-agent-ios

# Charts:
# http://stackoverflow.com/a/13306888/127816
Pod::Spec.new do |s|
  s.name             = "LegalAgent"
  s.version          = "1.0.0"
  s.summary          = "法律智能体iOS客户端"
  s.description      = "基于SwiftUI的法律智能体移动端应用，提供AI法律咨询、案件分析等功能"
  s.homepage         = "https://github.com/SapiensAI/legal-agent-ios"
  s.license          = { :type => "MIT", :file => "LICENSE" }
  s.author           = { "Sapiens AI" => "contact@sapiensai.com" }
  s.source           = { :git => "https://github.com/SapiensAI/legal-agent-ios.git", :tag => s.version }
  
  s.ios.deployment_target = "15.0"
  s.swift_version = "5.7"
  
  s.source_files = "LegalAgent/**/*.swift"
  s.resources = "LegalAgent/Resources/*"
  
  # 依赖
  s.dependency "Alamofire", "~> 5.8"
  s.dependency "Kingfisher", "~> 7.0"
  s.dependency "CombineExt", "~> 1.0"
  s.dependency "SwiftLint", "~> 0.52", :configuration => [:development]
end
