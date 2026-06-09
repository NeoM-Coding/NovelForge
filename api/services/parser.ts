/**
 * 文档解析服务
 * 支持 txt, docx, pdf
 * 解析为章节数组
 */

import { promises as fs } from "fs"

export interface ParsedChapter {
  chapterNumber: number
  title: string
  content: string
}

// 从文件扩展名判断类型
function getFileType(filePath: string): "txt" | "docx" | "pdf" {
  const ext = filePath.split(".").pop()?.toLowerCase()
  if (ext === "docx") return "docx"
  if (ext === "pdf") return "pdf"
  return "txt"
}

// 通用章节切分（基于常见章节标题模式）
function splitIntoChapters(text: string): ParsedChapter[] {
  // 匹配 "Chapter 1", "第1章", "第一章", "CHAPTER I" 等模式
  const chapterRegex = /(?:^(?:Chapter|CHAPTER|第[一二三四五六七八九十\d]+章|第\d+章)[\s:：]*(.+)?$)/gm

  const chapters: ParsedChapter[] = []
  const matches: Array<{ index: number; title: string }> = []

  let match: RegExpExecArray | null
  while ((match = chapterRegex.exec(text)) !== null) {
    matches.push({
      index: match.index,
      title: match[1]?.trim() || `Chapter ${matches.length + 1}`,
    })
  }

  if (matches.length === 0) {
    // 没有章节标题，按字数自动切分章节（每章约 5000-6000 字符，优先段落边界）
    return autoSplitChapters(text.trim())
  }

  let chapterNumber = 0
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length
    const content = text.slice(start, end).trim()

    // 提取内容（去掉章节标题行）
    const lines = content.split("\n")
    const bodyLines = lines.slice(1) // 去掉标题行

    chapters.push({
      chapterNumber: ++chapterNumber,
      title: matches[i].title,
      content: bodyLines.join("\n").trim() || content,
    })
  }

  return chapters
}

// 按字数自动切分章节（优先段落边界，目标每章 5000-6000 字符）
function autoSplitChapters(text: string, targetSize = 5500): ParsedChapter[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const chapters: ParsedChapter[] = []
  let currentChunk = ""
  let chapterNum = 0

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > targetSize && currentChunk.length > targetSize * 0.5) {
      chapters.push({
        chapterNumber: ++chapterNum,
        title: `第${chapterNum}章`,
        content: currentChunk.trim(),
      })
      currentChunk = para
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para
    }
  }

  if (currentChunk.trim().length > 0) {
    chapters.push({
      chapterNumber: ++chapterNum,
      title: `第${chapterNum}章`,
      content: currentChunk.trim(),
    })
  }

  return chapters
}

// 解析 TXT
async function parseTxt(filePath: string): Promise<ParsedChapter[]> {
  const text = await fs.readFile(filePath, "utf-8")
  return splitIntoChapters(text)
}

// 解析 DOCX
async function parseDocx(filePath: string): Promise<ParsedChapter[]> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ path: filePath })
  return splitIntoChapters(result.value)
}

// 解析 PDF
async function parsePdf(filePath: string): Promise<ParsedChapter[]> {
  // @ts-ignore — pdf-parse has no declaration for this subpath
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default
  const buffer = await fs.readFile(filePath)
  const result = await pdfParse(buffer)
  return splitIntoChapters(result.text)
}

/**
 * 解析平行语料（原文+译文对照格式）
 * 支持分隔符："===" 或 "---" 或 "|||" 或 空行分隔
 */
export function parseParallelCorpus(content: string): Array<{ source: string; translated: string }> {
  const DELIMITERS = ["===", "---", "|||"]
  const lines = content.split("\n").map(l => l.trim())
  const pairs: Array<{ source: string; translated: string }> = []

  // 方法1：用显式分隔符检测
  for (const delim of DELIMITERS) {
    if (content.includes(delim)) {
      const segments = content.split(delim).map(s => s.trim()).filter(s => s.length > 0)
      // 期望偶数个段落：source1, trans1, source2, trans2...
      for (let i = 0; i < segments.length - 1; i += 2) {
        pairs.push({ source: segments[i], translated: segments[i + 1] })
      }
      return pairs
    }
  }

  // 方法2：空行分隔（原文和译文交替）
  // 假设奇数行是原文，偶数行是译文
  const nonEmptyLines = lines.filter(l => l.length > 0)
  for (let i = 0; i < nonEmptyLines.length - 1; i += 2) {
    const source = nonEmptyLines[i]
    const translated = nonEmptyLines[i + 1]
    // 简单启发式：如果一行含大量中文字符（>50%），视为译文
    const chineseCharCount = (source.match(/[一-鿿]/g) || []).length
    if (chineseCharCount / source.length > 0.5) {
      // 这行应该是译文，交换
      pairs.push({ source: translated, translated: source })
    } else {
      pairs.push({ source, translated })
    }
  }

  return pairs
}

// 主解析函数
export async function parseDocument(filePath: string): Promise<{
  chapters: ParsedChapter[]
  fileType: string
}> {
  const fileType = getFileType(filePath)
  let chapters: ParsedChapter[]

  switch (fileType) {
    case "docx":
      chapters = await parseDocx(filePath)
      break
    case "pdf":
      chapters = await parsePdf(filePath)
      break
    default:
      chapters = await parseTxt(filePath)
  }

  // 过滤空章节
  chapters = chapters.filter(ch => ch.content.length > 50)

  // 如果过滤后没有章节，整本书作为一个章节
  if (chapters.length === 0) {
    const text = await fs.readFile(filePath, "utf-8")
    chapters = [{ chapterNumber: 1, title: "全文", content: text.trim() }]
  }

  return { chapters, fileType }
}
