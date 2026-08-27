interface ParsedExpense {
  name: string
  amount: number
  category: string
  confirmed: boolean
}

interface ParsedHabit {
  name: string
  done: boolean
  confirmed: boolean
}

interface ParsedResult {
  expenses: ParsedExpense[]
  diary: string | null
  mood: 'happy' | 'good' | 'normal' | 'low' | 'sad' | 'angry' | 'anxious' | null
  moodScore: number
  habits: ParsedHabit[]
  todos: string[]
}

const expensePatterns = [
  { regex: /(?:午饭|午餐|中饭)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '午饭', category: 'food' },
  { regex: /(?:早饭|早餐)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '早饭', category: 'food' },
  { regex: /(?:晚饭|晚餐|晚)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '晚饭', category: 'food' },
  { regex: /(?:奶茶|咖啡|饮料|水)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '饮品', category: 'food' },
  { regex: /(?:打车|滴滴|出租)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '打车', category: 'transport' },
  { regex: /(?:地铁|公交)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '公共交通', category: 'transport' },
  { regex: /(?:电影|票)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '电影票', category: 'entertainment' },
  { regex: /(?:书|教材|文具)[^\d]*?(\d+(?:\.\d+)?)\s*元?/g, name: '学习用品', category: 'study' },
  { regex: /(\S{1,6}?)[^\d]*?(\d+(?:\.\d+)?)\s*元/g, name: '', category: 'other' },
  { regex: /(?:花了|花|消费|买了|买了个|付了|支付了)\s*(\d+(?:\.\d+)?)/g, name: '消费', category: 'other' },
]

const habitKeywords: Record<string, { icon: string; name: string }> = {
  '跑步': { icon: '🏃', name: '跑步' },
  '背单词': { icon: '📖', name: '背单词' },
  '早睡': { icon: '😴', name: '早睡' },
  '读书': { icon: '📚', name: '读书' },
  '运动': { icon: '💪', name: '运动' },
  '健身': { icon: '🏋️', name: '健身' },
  '冥想': { icon: '🧘', name: '冥想' },
  '写日记': { icon: '📝', name: '写日记' },
  '喝水': { icon: '💧', name: '喝水' },
  '练琴': { icon: '🎹', name: '练琴' },
  '画画': { icon: '🎨', name: '画画' },
}

const moodKeywords: Record<string, { mood: ParsedResult['mood']; score: number; keywords: string[] }> = {
  happy: { mood: 'happy', score: 8, keywords: ['开心', '高兴', '爽', '棒', '快乐', '幸福', '兴奋', '太好了', '哈哈', '嘻嘻'] },
  good: { mood: 'good', score: 7, keywords: ['不错', '还行', '挺好', '可以', '满意'] },
  normal: { mood: 'normal', score: 5, keywords: ['一般', '普通', '就那样', '还好'] },
  low: { mood: 'low', score: 4, keywords: ['有点烦', '不太开心', '郁闷', '无聊', '累', '疲倦'] },
  sad: { mood: 'sad', score: 3, keywords: ['难过', '伤心', '丧', '不开心', '烦死了', '崩溃'] },
  angry: { mood: 'angry', score: 2, keywords: ['生气', '气死', '愤怒', '烦透了', '恼火'] },
  anxious: { mood: 'anxious', score: 3, keywords: ['焦虑', '紧张', '担心', '不安', '压力大', '害怕'] },
}

const todoPatterns = [
  /要(?:去做|去|做|记[得着])(.{2,20})/g,
  /明天[得要](.{2,20})/g,
  /别忘了(.{2,20})/g,
  /记得(.{2,20})/g,
  /需要(.{2,20})/g,
]

export function parseQuickNote(input: string): ParsedResult {
  const expenses: ParsedExpense[] = []
  const habits: ParsedHabit[] = []
  const todos: string[] = []
  let mood: ParsedResult['mood'] = null
  let moodScore = 5

  let cleanedInput = input

  for (const pattern of expensePatterns) {
    let match
    pattern.regex.lastIndex = 0
    while ((match = pattern.regex.exec(input)) !== null) {
      const amount = parseFloat(match[match.length - 1])
      if (amount > 0 && amount < 10000) {
        const name = match.length > 2 ? match[1] : pattern.name
        expenses.push({
          name: name || pattern.name || '消费',
          amount: Math.round(amount * 100),
          category: pattern.category,
          confirmed: true,
        })
        cleanedInput = cleanedInput.replace(match[0], '')
      }
    }
  }

  for (const [key, info] of Object.entries(habitKeywords)) {
    const negativeRegex = new RegExp(`没(有|去|做|来得及|空)?${key}|不(想|能|去)?${key}|下雨.*没${key}|${key}(失败|没做到|中断|断了)`)
    const positiveRegex = new RegExp(`${key}了|${key}完|完成.*${key}|已经${key}|坚持${key}`)

    if (negativeRegex.test(input)) {
      habits.push({ name: info.name, done: false, confirmed: true })
    } else if (positiveRegex.test(input)) {
      habits.push({ name: info.name, done: true, confirmed: true })
    } else if (input.includes(key)) {
      habits.push({ name: info.name, done: true, confirmed: true })
    }
  }

  for (const [, data] of Object.entries(moodKeywords)) {
    for (const kw of data.keywords) {
      if (input.includes(kw)) {
        if (!mood || data.score < moodScore) {
          mood = data.mood
          moodScore = data.score
        }
        break
      }
    }
  }

  for (const pattern of todoPatterns) {
    let match
    pattern.lastIndex = 0
    while ((match = pattern.exec(input)) !== null) {
      const text = match[1].trim()
      if (text.length >= 2 && text.length <= 20) {
        todos.push(text)
      }
    }
  }

  const diaryText = cleanedInput
    .replace(/\d+(?:\.\d+)?\s*元/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    expenses,
    diary: diaryText.length > 5 ? diaryText : null,
    mood,
    moodScore,
    habits,
    todos,
  }
}
