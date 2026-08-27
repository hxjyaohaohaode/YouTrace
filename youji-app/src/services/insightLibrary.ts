import type { InsightType } from '../stores/coachStore';

export interface UniversalInsight {
  type: InsightType;
  title: string;
  description: string;
  dataSources: string[];
  actionSuggested?: string;
  significance: number;
}

export const universalInsights: UniversalInsight[] = [
  { type: 'suggestion', title: '月初控制花销', description: '月初往往是花销最容易失控的时段。这个月试着在前10天放慢消费节奏，月底会轻松很多。', dataSources: ['expense'], actionSuggested: '前10天给自己设一个日均上限', significance: 0.6 },
  { type: 'pattern', title: '周日晚上提前休息', description: '很多人周日晚上容易焦虑，睡得也晚。今晚早点休息，为下周储备精力。', dataSources: ['mood'], actionSuggested: '今晚23:00前放下手机', significance: 0.5 },
  { type: 'suggestion', title: '运动与情绪', description: '规律运动对情绪的改善是很多研究反复验证过的。如果最近没动起来，今天是个好时机。', dataSources: ['habit', 'mood'], actionSuggested: '今天试试15分钟散步或慢跑', significance: 0.55 },
  { type: 'positive', title: '社交对情绪的帮助', description: '和朋友面对面的相处，往往比独自待着更能改善情绪。别把自己关在屋里。', dataSources: ['mood'], significance: 0.5 },
  { type: 'pattern', title: '考试季提醒', description: '考试周最容易牺牲睡眠。如果有考试临近，现在开始调整作息还来得及。', dataSources: ['schedule', 'habit'], actionSuggested: '本周每天提前30分钟上床', significance: 0.65 },
  { type: 'suggestion', title: '周一综合症', description: '周一上午对很多人来说是效率低谷。别把最难的任务排在周一，把难事放到周二到周四。', dataSources: ['schedule'], actionSuggested: '周一上午安排轻松任务', significance: 0.45 },
  { type: 'pattern', title: '月末效应', description: '月底常常出现"报复性消费"或者"补回来"的心态。留意月底的非必要支出。', dataSources: ['expense'], actionSuggested: '月底控制非必要消费', significance: 0.5 },
  { type: 'suggestion', title: '午睡的力量', description: '20分钟左右的午睡能明显恢复下午的专注力，睡太久反而更困。', dataSources: ['habit'], actionSuggested: '午休时间试试20分钟小睡', significance: 0.45 },
  { type: 'correlation', title: '咖啡因陷阱', description: '下午晚些时候的咖啡或奶茶，很可能让你晚上更难入睡，第二天更困、更想喝——留意这个循环。', dataSources: ['expense', 'habit'], actionSuggested: '下午3点后改喝水或茶', significance: 0.6 },
  { type: 'positive', title: '写日记的好处', description: '定期把情绪写下来，本身就是一种情绪管理。你已经在做了，继续坚持！', dataSources: ['diary'], significance: 0.4 },
  { type: 'suggestion', title: '图书馆效应', description: '环境对专注力的影响比想象中大。在宿舍学不进去的时候，换个环境往往立竿见影。', dataSources: ['schedule'], actionSuggested: '今天去图书馆自习1小时', significance: 0.5 },
  { type: 'pattern', title: '周五消费高峰', description: '周末前的放松心态容易带来社交和外卖消费。周五快乐可以，但要有预算意识。', dataSources: ['expense'], actionSuggested: '给周五的社交消费设个上限', significance: 0.55 },
  { type: 'suggestion', title: '2分钟法则', description: '如果一件事2分钟内能做完，立刻做。别加到待办里，加待办的时间比做这件事还长。', dataSources: ['todo'], significance: 0.4 },
  { type: 'correlation', title: '零食与压力', description: '压力大的时候，零食消费常常悄悄上涨。这是压力消费，不是真的饿了。', dataSources: ['expense', 'schedule'], actionSuggested: '提前准备水果和坚果替代零食', significance: 0.65 },
  { type: 'suggestion', title: '睡前1小时', description: '睡前放下手机，入睡会容易很多。屏幕蓝光会抑制褪黑素分泌。', dataSources: ['habit'], actionSuggested: '23:00后手机放到够不到的地方', significance: 0.55 },
  { type: 'positive', title: '连续3天效应', description: '习惯打卡前几天是最容易放弃的阶段。撑过头几天，坚持就会变得容易。', dataSources: ['habit'], significance: 0.5 },
  { type: 'pattern', title: '天气与情绪', description: '连续阴天时情绪低落是很正常的生理反应。天气不好的日子，对自己宽容一点。', dataSources: ['mood'], significance: 0.4 },
  { type: 'suggestion', title: '社交预算', description: '社交是刚需，但值得单独设一个预算上限，避免它悄悄吃掉其他开支。', dataSources: ['expense'], actionSuggested: '给社交支出单独设一个月度上限', significance: 0.5 },
  { type: 'correlation', title: '运动与睡眠', description: '白天适度运动，晚上通常更容易入睡、睡得更深。运动是最好的助眠方式之一。', dataSources: ['habit', 'mood'], actionSuggested: '今天试试傍晚运动30分钟', significance: 0.55 },
  { type: 'suggestion', title: '早餐投资', description: '一顿正常的早餐换来上午的专注力，性价比通常很高。', dataSources: ['expense'], actionSuggested: '明天早起10分钟吃个早餐', significance: 0.45 },
  { type: 'pattern', title: '开学季', description: '新学期开始是设定目标的好时机。别等期中才开始努力。', dataSources: ['schedule'], actionSuggested: '设定本学期的3个小目标', significance: 0.5 },
  { type: 'pattern', title: '期末倒计时', description: '期末复习宜早不宜迟。现在开始列复习计划，最后一周会从容很多。', dataSources: ['schedule'], actionSuggested: '今天列出要复习的章节', significance: 0.6 },
  { type: 'suggestion', title: '假期作息', description: '假期最容易打乱作息。设一个弹性目标：比平时晚起一点可以，但别超过2小时。', dataSources: ['habit'], actionSuggested: '假期也设一个起床时间', significance: 0.4 },
  { type: 'suggestion', title: '记账的心理效应', description: '仅仅是"记录花销"这个动作，就会让你在下单前多想一秒。关注本身就是控制。', dataSources: ['expense'], significance: 0.4 },
  { type: 'correlation', title: '早睡与花销', description: '晚睡的第二天往往更依赖奶茶零食提神。改善睡眠，钱包也会跟着受益。', dataSources: ['habit', 'expense'], actionSuggested: '今晚提前30分钟睡觉', significance: 0.7 },
  { type: 'suggestion', title: '替代消费', description: '每天一杯奶茶，一个月下来是一笔可观的开销。不是不能喝，而是让选择变得有意识。', dataSources: ['expense'], significance: 0.5 },
  { type: 'suggestion', title: '时薪思维', description: '把价格换算成你的时薪再决定：这杯饮品值不值你半小时的工作？答案因时而异，但值得想一想。', dataSources: ['expense'], significance: 0.45 },
  { type: 'positive', title: '小习惯的力量', description: '每天背10个单词，一年就是3000多个。小习惯的复利效应是惊人的。', dataSources: ['habit'], significance: 0.45 },
  { type: 'pattern', title: '周末陷阱', description: '周末是习惯最容易断的日子。建议周末至少保留1个核心习惯不断档。', dataSources: ['habit'], actionSuggested: '周末保留1个核心习惯不中断', significance: 0.5 },
  { type: 'suggestion', title: '番茄工作法', description: '25分钟专注加5分钟休息的节奏，比硬撑连续学习更容易维持专注。', dataSources: ['schedule'], actionSuggested: '今天试试1个番茄钟', significance: 0.4 },
  { type: 'correlation', title: '社交消费值不值', description: '如果社交花销换来的是好情绪，这钱通常花得值。优化其他支出，而不是砍掉社交。', dataSources: ['expense', 'mood'], significance: 0.55 },
  { type: 'suggestion', title: '情绪低落时', description: '情绪低落时，尽量别做重要决定——包括消费。给自己24小时冷静期。', dataSources: ['mood', 'expense'], significance: 0.5 },
  { type: 'pattern', title: '下午3点低谷', description: '下午3点前后是很多人精力的最低点。安排轻松任务或短暂休息更划算。', dataSources: ['schedule'], actionSuggested: '下午3点安排休息或轻松任务', significance: 0.4 },
  { type: 'suggestion', title: '喝水代替零食', description: '很多时候你以为饿了，其实只是渴了。想吃零食前，先喝一杯水等10分钟。', dataSources: ['expense'], actionSuggested: '买零食前先喝杯水', significance: 0.4 },
  { type: 'positive', title: '写长日记的好处', description: '写得越多，对自己的了解越深。日记是和自己对话的方式。', dataSources: ['diary'], significance: 0.35 },
  { type: 'suggestion', title: '目标分解', description: '大目标让人焦虑，小目标让人行动。"复习高数"不如"今天做3道泰勒展开题"容易开始。', dataSources: ['todo'], actionSuggested: '把今天最难的任务分解成3个小步骤', significance: 0.45 },
  { type: 'pattern', title: '首次超支', description: '第一次超预算不用慌，几乎每个人都会遇到。关键是别让超支变成常态。', dataSources: ['expense'], significance: 0.5 },
  { type: 'suggestion', title: '手机使用时间', description: '刷社交媒体的时间常常比预想的多。今天试试留出2小时完全不看手机。', dataSources: ['schedule'], actionSuggested: '今天试试2小时不看社交媒体', significance: 0.45 },
  { type: 'correlation', title: '运动与自信', description: '坚持运动带来的掌控感，会慢慢扩散到生活的其他方面。', dataSources: ['habit', 'mood'], significance: 0.5 },
  { type: 'suggestion', title: '提前准备', description: '考试前的焦虑，多半来自"还没开始准备"。提前两周动手，焦虑会小很多。', dataSources: ['schedule', 'mood'], actionSuggested: '考试前2周开始复习计划', significance: 0.55 },
  { type: 'pattern', title: '季节性情绪', description: '秋冬情绪低落是常见现象。多晒太阳、多运动，对缓解很有帮助。', dataSources: ['mood'], actionSuggested: '天气好的时候出去走走', significance: 0.4 },
  { type: 'suggestion', title: '室友关系', description: '好的室友关系是生活质量的关键。主动沟通比忍着好，小问题别拖成大矛盾。', dataSources: ['mood'], significance: 0.35 },
  { type: 'correlation', title: '规律作息的连锁效应', description: '规律作息→白天精力好→不需要靠咖啡因硬撑→省下钱也少焦虑→睡得更好。一个良性循环。', dataSources: ['habit', 'expense', 'mood'], significance: 0.6 },
  { type: 'suggestion', title: '学习环境切换', description: '在一个地方学不进去？换个地方。环境切换可以重置大脑的专注状态。', dataSources: ['schedule'], actionSuggested: '换个地方学习试试', significance: 0.35 },
  { type: 'positive', title: '你比想象中好', description: '回头看一个月前的自己，你会发现变化比想象中大。', dataSources: ['mood'], significance: 0.35 },
  { type: 'suggestion', title: '拒绝完美主义', description: '"要么做到最好，要么不做"——这是拖延最常见的借口。做到60分比0分好太多。', dataSources: ['todo'], significance: 0.4 },
  { type: 'pattern', title: '消费冲动期', description: '深夜是最容易冲动消费的时段，大脑疲劳时自控力会下降。购物车先放一晚。', dataSources: ['expense'], actionSuggested: '晚上10点后不下单', significance: 0.5 },
  { type: 'suggestion', title: '感恩练习', description: '睡前想3件今天值得感谢的小事，是成本最低的情绪调节方式。', dataSources: ['mood'], actionSuggested: '今晚睡前想3件好事', significance: 0.4 },
  { type: 'correlation', title: '独处与社交的平衡', description: '纯独处容易低落，纯社交容易疲惫。给自己留出两种时间，别偏向极端。', dataSources: ['mood'], significance: 0.4 },
  { type: 'suggestion', title: '任务优先级', description: '每天最多选3件重要任务。超过3件，你只会焦虑地切换，而不是专注地完成。', dataSources: ['todo'], actionSuggested: '今天只选3件最重要的事', significance: 0.45 },
  { type: 'pattern', title: '假期后综合症', description: '假期结束后第一周效率低是正常的。别给自己太大压力，慢慢恢复节奏。', dataSources: ['schedule'], significance: 0.35 },
  { type: 'suggestion', title: '深呼吸', description: '焦虑时试试4-7-8呼吸法：吸气4秒、屏住7秒、呼气8秒，几个循环就有帮助。', dataSources: ['mood'], significance: 0.35 },
  { type: 'correlation', title: '睡眠与记忆', description: '睡眠不足时，大脑巩固记忆的效率会明显下降。熬夜复习往往得不偿失。', dataSources: ['habit', 'schedule'], actionSuggested: '考试前保证7小时睡眠', significance: 0.55 },
  { type: 'suggestion', title: '微习惯', description: '想养成跑步习惯？从"穿上跑鞋"开始。只要穿上，就算完成。大部分时候你会走出去的。', dataSources: ['habit'], actionSuggested: '设定一个超小的习惯起点', significance: 0.45 },
  { type: 'positive', title: '你已经在变好了', description: '愿意记录生活、反思自己，这本身就是很稀缺的能力。大多数人连这一步都走不到。', dataSources: ['diary'], significance: 0.4 },
];
