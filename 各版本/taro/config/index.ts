/**
 * Taro配置（config/index.ts 形式）
 */
import { defineConfig } from '@tarojs/cli'

export default defineConfig(async () => ({
  compiler: 'typescript',
  framework: 'react',
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: {
      mode: 'history',
    },
    postcss: {
      autoprefixer: {
        enable: true,
      },
    },
  },
  rn: {
    appName: 'LegalAgent',
  },
}))
