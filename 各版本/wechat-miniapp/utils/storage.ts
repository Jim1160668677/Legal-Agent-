/**
 * 存储工具 - 封装微信 Storage 操作
 */

const storage = {
  /**
   * 同步设置存储
   */
  setStorageSync(key: string, value: any): void {
    wx.setStorageSync(key, value)
  },

  /**
   * 同步获取存储
   */
  getStorageSync<T = any>(key: string): T | null {
    try {
      const value = wx.getStorageSync(key)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  },

  /**
   * 异步设置存储
   */
  setStorage(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.setStorage({
        key,
        data: JSON.stringify(value),
        success: () => resolve(),
        fail: (err) => reject(err),
      })
    })
  },

  /**
   * 异步获取存储
   */
  getStorage<T = any>(key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      wx.getStorage({
        key,
        success: (res) => {
          try {
            resolve(JSON.parse(res.data))
          } catch {
            resolve(res.data as T)
          }
        },
        fail: (err) => reject(err),
      })
    })
  },

  /**
   * 删除存储
   */
  removeStorageSync(key: string): void {
    wx.removeStorageSync(key)
  },

  /**
   * 清空所有存储
   */
  clearStorageSync(): void {
    wx.clearStorageSync()
  },

  /**
   * 获取所有存储信息
   */
  getStorageInfoSync(): { keys: string[]; currentSize: number; maxSize: number } {
    return wx.getStorageInfoSync()
  },
}

export default storage
