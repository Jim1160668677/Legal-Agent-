package com.sapiensai.legalagent.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sapiensai.legalagent.util.Constants

@Composable
fun CaseTypeSelector(
    selectedType: String,
    onTypeSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val caseTypes = listOf(
        Constants.CaseTypes.CIVIL,
        Constants.CaseTypes.CRIMINAL,
        Constants.CaseTypes.COMMERCIAL,
        Constants.CaseTypes.ADMINISTRATIVE,
        Constants.CaseTypes.LABOR,
        Constants.CaseTypes.PROPERTY,
        Constants.CaseTypes.CONTRACT,
        Constants.CaseTypes.OTHER
    )

    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(caseTypes) { type ->
            FilterChip(
                selected = selectedType == type,
                onClick = { onTypeSelected(type) },
                label = { Text(type) }
            )
        }
    }
}
