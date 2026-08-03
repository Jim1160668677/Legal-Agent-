/**
 * Taro路由配置
 */
export default {
  pages: [
    'pages/login/index',
    'pages/chat/index',
    'pages/analysis/index',
    'pages/knowledge/index',
    'pages/profile/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1890ff',
    navigationBarTitleText: '法律智能体',
    navigationBarTextStyle: 'white',
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#1890ff',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/chat/index',
        text: '对话',
        iconPath: 'assets/icons/chat.png',
        selectedIconPath: 'assets/icons/chat-active.png',
      },
      {
        pagePath: 'pages/analysis/index',
        text: '分析',
        iconPath: 'assets/icons/analysis.png',
        selectedIconPath: 'assets/icons/analysis-active.png',
      },
      {
        pagePath: 'pages/knowledge/index',
        text: '知识',
        iconPath: 'assets/icons/knowledge.png',
        selectedIconPath: 'assets/icons/knowledge-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/icons/profile.png',
        selectedIconPath: 'assets/icons/profile-active.png',
      },
    ],
  },
  mini: {
    appid: 'YOUR_WECHAT_APPID',
    miniprogramRoot: 'dist/',
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
    },
  },
  h5: {
    router: {
      mode: 'history',
    },
    publicPath: '/',
    title: '法律智能体',
    postcss: {
      autoprefixer: {
        enable: true,
      },
    },
  },
}
