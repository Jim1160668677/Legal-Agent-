package com.sapiensai.legalagent.util

import java.text.SimpleDateFormat
import java.util.*

object DateUtils {
    private val SHORT_FORMAT = SimpleDateFormat("HH:mm", Locale.CHINA)
    private val DATE_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA)
    private val DATETIME_FORMAT = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)

    fun formatTime(timestamp: Long): String {
        if (timestamp == 0L) return ""
        val now = System.currentTimeMillis()
        val diff = now - timestamp
        return if (diff < 60_000) {
            "刚刚"
        } else if (diff < 3_600_000) {
            "${diff / 60_000}分钟前"
        } else if (diff < 86_400_000) {
            SHORT_FORMAT.format(Date(timestamp))
        } else if (diff < 172_800_000) {
            "昨天 ${SHORT_FORMAT.format(Date(timestamp))}"
        } else {
            DATE_FORMAT.format(Date(timestamp))
        }
    }

    fun formatDateTime(timestamp: Long): String =
        if (timestamp == 0L) "" else DATETIME_FORMAT.format(Date(timestamp))
}
