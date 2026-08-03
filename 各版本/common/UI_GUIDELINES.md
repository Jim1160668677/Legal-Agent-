# 法律智能体 UI/UX 设计规范

## 设计原则

1. **专业性**: 体现法律行业的严谨与权威
2. **易用性**: 简化复杂法律流程，降低用户使用门槛
3. **一致性**: 跨平台体验统一
4. **可访问性**: 支持无障碍访问

## 色彩体系

### 主色系
```css
:root {
  /* 主色 */
  --primary-color: #1890ff;
  --primary-hover: #40a9ff;
  --primary-active: #096dd9;
  
  /* 辅助色 */
  --success-color: #52c41a;
  --warning-color: #faad14;
  --error-color: #f5222d;
  --info-color: #1890ff;
  
  /* 中性色 */
  --text-primary: #000000;
  --text-secondary: #666666;
  --text-disabled: #bfbfbf;
  --border-color: #d9d9d9;
  --bg-color: #ffffff;
  --bg-secondary: #fafafa;
}
```

### 法律行业专用色
```css
/* 法条引用高亮 */
--law-citation: #e6f7ff;
--law-citation-border: #91d5ff;

/* 风险等级 */
--risk-high: #ff4d4f;
--risk-medium: #faad14;
--risk-low: #52c41a;
```

## 字体规范

### 字体栈
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 
             'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', 
             Helvetica, Arial, sans-serif;
```

### 字号层级
```
h1:   32px / 40px (页面标题)
h2:   24px / 32px (区块标题)
h3:   20px / 28px (卡片标题)
body: 16px / 24px (正文)
small: 14px / 20px (辅助文字)
caption: 12px / 16px (说明文字)
```

### 字重
```
regular: 400
medium:  500
semibold: 600
bold:    700
```

## 间距系统

基于 8px 基准网格：

```
4px   - 超小间距（图标旁）
8px   - 小间距（按钮内边距）
12px  - 中介距（卡片内边距）
16px  - 大间距（模块间距）
24px  - 超大间距（页面区块）
32px  - 页面级间距
48px  - 区块级间距
```

## 圆角规范

```
sm:  4px   (标签、徽章)
md:  8px   (按钮、输入框、卡片)
lg:  12px  (对话框、模态框)
xl:  16px  (大卡片、容器)
full: 9999px (头像、圆形按钮)
```

## 阴影层级

```css
.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); }
.shadow-xl { box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); }
```

## 组件规范

### 按钮
```
主要按钮: 蓝底白字，用于主要操作
次要按钮: 白底蓝字边框，用于辅助操作
危险按钮: 红底白字，用于删除等危险操作
文字按钮: 纯文字，用于链接式操作
```

### 输入框
```
默认状态: 灰色边框
聚焦状态: 蓝色边框 + 阴影
错误状态: 红色边框 + 错误提示
禁用状态: 灰色背景 + 灰色文字
```

### 卡片
```
内容卡片: 白色背景 + 轻微阴影
交互卡片: 可点击，hover时阴影加深
数据卡片: 突出显示关键数据
```

### 对话框
```
确认对话框: 询问用户是否继续
提示对话框: 展示重要信息
表单对话框: 收集用户输入
```

## 页面布局

### PC端布局
```
┌─────────────────────────────────────────┐
│  Header (固定顶部，高度64px)             │
├──────────┬──────────────────────────────┤
│          │                              │
│ Sidebar  │      Main Content            │
│ (240px)  │      (flex: 1)               │
│          │                              │
├──────────┴──────────────────────────────┤
│  Footer (可选，高度48px)                 │
└─────────────────────────────────────────┘
```

### 移动端布局
```
┌─────────────────┐
│  Header (56px)  │
├─────────────────┤
│                 │
│   Content       │
│   (flex: 1)     │
│                 │
├─────────────────┤
│  TabBar (56px)  │
└─────────────────┘
```

## 交互反馈

### 加载状态
```
全屏加载: 旋转 Spinner
局部加载: Skeleton Screen
按钮加载: Loading 状态
列表加载: 下拉刷新 + 上拉加载更多
```

### 错误处理
```
Toast提示: 轻量级错误提示（2-3秒自动消失）
Error边界: 组件级错误捕获
Error页面: 路由级错误展示
```

### 空状态
```
 Illustration + 引导文案 + 操作按钮
```

## 动画规范

### 过渡动画
```
淡入淡出: 200ms ease
滑入滑出: 300ms ease
缩放: 200ms ease
```

### 微交互
```
按钮点击: scale(0.95) 反馈
卡片悬停: translateY(-2px) + 阴影加深
列表项: slide-in 动画
```

## 无障碍设计

### 键盘导航
- Tab键顺序符合视觉顺序
- Focus状态清晰可见
- 支持快捷键

### 屏幕阅读器
- 语义化HTML标签
- ARIA属性完整
- 图片alt文本

### 对比度
- 文字对比度 ≥ 4.5:1
- 大图文字对比度 ≥ 3:1

## 各平台适配

### Web端
- 响应式断点: 768px / 992px / 1200px
- 鼠标交互优化
- 键盘快捷操作

### 小程序
- 小程序规范约束
- 触摸交互优化
- 分包加载

### Android
- Material Design 3
- 底部导航
- 手势返回

### iOS
- Human Interface Guidelines
- 滑动返回
- 动态岛适配

### HarmonyOS
- 鸿蒙设计规范
- 服务卡片
- 流转能力

## 图标规范

### 图标库
推荐使用 Ant Design Icons 或 Material Icons

### 图标尺寸
```
xs:  12px
sm:  16px
md:  20px
lg:  24px
xl:  32px
```

### 图标样式
- 线条图标: 2px stroke
- 填充图标: 实心
- 双色图标: 主次色区分
