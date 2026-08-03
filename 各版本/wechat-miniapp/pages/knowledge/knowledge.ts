// pages/knowledge/knowledge.ts
const { api } = require('../../utils/api')

Page({
  data: {
    searchQuery: '',
    loading: false,
    hasSearched: false,
    results: [],
    page: 1,
    hasMore: true,
    categories: [
      { name: '全部', value: '' },
      { name: '合同法', value: 'contract' },
      { name: '劳动法', value: 'labor' },
      { name: '婚姻法', value: 'marriage' },
      { name: '继承法', value: 'inheritance' },
      { name: '刑法', value: 'criminal' },
      { name: '民法', value: 'civil' },
      { name: '公司法', value: 'company' },
      { name: '知识产权', value: 'ip' },
    ],
    activeCategory: '',
  },

  onSearchInput(e: any) {
    this.setData({ searchQuery: e.detail.value })
  },

  clearSearch() {
    this.setData({ searchQuery: '' })
  },

  selectCategory(e: any) {
    const value = e.currentTarget.dataset.value
    this.setData({
      activeCategory: value,
      results: [],
      hasSearched: false,
      page: 1,
    })
    if (this.data.searchQuery) {
      this.search()
    }
  },

  onSearch() {
    this.search()
  },

  async search() {
    const { searchQuery, activeCategory, page } = this.data
    if (!searchQuery.trim()) {
      wx.showToast({ title: '请输入搜索关键词', icon: 'none' })
      return
    }

    this.setData({ loading: true, hasSearched: true })

    try {
      const filters = activeCategory ? { category: activeCategory } : undefined
      const res = await api.searchKnowledge(searchQuery, filters, 10)
      const results = res.data?.items || []

      if (page === 1) {
        this.setData({ results, hasMore: results.length >= 10 })
      } else {
        this.setData({
          results: [...this.data.results, ...results],
          hasMore: results.length >= 10,
        })
      }
    } catch (error) {
      console.error('搜索失败:', error)
      wx.showToast({ title: '搜索失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    if (this.data.hasMore && !this.data.loading) {
      const newPage = this.data.page + 1
      this.setData({ page: newPage })
      this.search()
    }
  },

  viewDetail(e: any) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/knowledge-detail/knowledge-detail?id=${id}`,
    })
  },
})
