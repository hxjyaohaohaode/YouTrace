import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  const user = await prisma.user.upsert({
    where: { phone: '13800000000' },
    update: {},
    create: {
      id: 'demo-user-001',
      phone: '13800000000',
      nickname: '小林',
      identity: 'student',
      city: '北京',
      coachStyle: 'gentle',
    },
  })
  console.log(`Created user: ${user.nickname} (${user.phone})`)

  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  const habits = [
    { id: 'habit-run', name: '跑步30min', icon: '🏃', frequency: 'daily', sortOrder: 0 },
    { id: 'habit-word', name: '背单词50个', icon: '📖', frequency: 'daily', sortOrder: 1 },
    { id: 'habit-sleep', name: '11点前睡觉', icon: '😴', frequency: 'daily', sortOrder: 2 },
  ]

  for (const h of habits) {
    await prisma.habit.upsert({
      where: { id: h.id },
      update: {},
      create: { ...h, userId: user.id },
    })
  }

  for (const checkin of [
    { habitId: 'habit-run', date: today, done: true, source: 'manual', confirmed: true },
    { habitId: 'habit-word', date: today, done: true, source: 'manual', confirmed: true },
  ]) {
    const existing = await prisma.habitCheckin.findFirst({
      where: { habitId: checkin.habitId, date: checkin.date },
    })
    if (!existing) {
      await prisma.habitCheckin.create({ data: checkin })
    }
  }

  const expenses = [
    { id: 'exp-1', amount: 1500, category: 'food', name: '午饭', date: today, source: 'manual' },
    { id: 'exp-2', amount: 1200, category: 'food', name: '奶茶', date: today, source: 'manual' },
    { id: 'exp-3', amount: 800, category: 'transport', name: '打车', date: today, source: 'manual' },
    { id: 'exp-4', amount: 2200, category: 'food', name: '晚饭', date: yesterday, source: 'manual' },
    { id: 'exp-5', amount: 4500, category: 'entertainment', name: '电影票', date: yesterday, source: 'manual' },
  ]

  for (const e of expenses) {
    await prisma.expense.upsert({
      where: { id: e.id },
      update: {},
      create: { ...e, userId: user.id },
    })
  }

  const todos = [
    { id: 'todo-1', text: '回复导师邮件', dueDate: yesterday, priority: 'high', done: false },
    { id: 'todo-2', text: '交高数作业', dueDate: today, priority: 'high', done: false },
    { id: 'todo-3', text: '买洗衣液', dueDate: today, priority: 'low', done: false },
  ]

  for (const t of todos) {
    await prisma.todo.upsert({
      where: { id: t.id },
      update: {},
      create: { ...t, userId: user.id },
    })
  }

  console.log('Seed complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
