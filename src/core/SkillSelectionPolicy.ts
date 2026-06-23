export interface SkillSelectionPolicy {
  disabledSkillNames: string[];
  digestGuidance: string[];
}

export const SKILL_SELECTION_POLICY: SkillSelectionPolicy = {
  disabledSkillNames: [],
  digestGuidance: [
    '按任务目标主动选择 skill_names；用户显式写 $skill 时按指定 skill 优先。',
    '当用户要演示、幻灯片、deck、presentation 但没有指定交付格式时，默认优先生成原生可编辑 PPTX：使用 generate_pptx（底层 pptxgenjs）；只有用户明确要网页演示/交互动画/HTML 预览/多格式高保真导出时才走 HTML 演示路线。',
    '明确要 PPT/PPTX/PowerPoint/客户可编辑交付时必须使用 generate_pptx，后续改稿使用 edit_pptx；不要用 HTML/Slidev 静默替代原生 PPTX。HTML 导出的 PPTX 是逐页图片拼装，文字不可编辑，只适合视觉高保真分发。',
    '技术演示或代码课程可推荐 Slidev；但用户要求 PPT/PPTX 时仍以 generate_pptx 为默认。',
    '文档、报告、方案、材料没有指定格式时优先询问 DOCX/PDF/HTML；明确要 Word/DOCX 时使用 generate_docx（底层 docx），明确要 PDF 时按内容选择 generate_pdf（pdfkit 结构化）或 generate_html_document 导出 PDF（Chromium 高保真）。',
    '表格数据走 XLSX/edit_xlsx；PDF 解析必须标注是否有文本层，纯图/扫描件转 OCR 路径；素材需求走 office_ops(action="assets")。',
  ],
};

export function isSkillDisabledByPolicy(name: string): boolean {
  return SKILL_SELECTION_POLICY.disabledSkillNames.includes(name);
}
