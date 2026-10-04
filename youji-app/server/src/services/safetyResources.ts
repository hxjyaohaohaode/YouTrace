/**
 * Shared, data-only safety resources. Safe to import from the browser: no server
 * dependencies, credentials, or runtime environment access belong in this file.
 */
export const mainlandPsychologicalSupport = {
  id: 'cn-12356',
  region: '中国大陆',
  type: 'psychological_support',
  name: '全国统一心理援助热线',
  phone: '12356',
  tel: 'tel:12356',
  availability: '具体接听时间和接通情况以当地服务为准',
  verifiedAt: '2026-10-04',
  sources: [
    {
      title: '国家卫生健康委关于应用“12356”全国统一心理援助热线电话号码的通知',
      url: 'https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml',
    },
    {
      title: '国家卫生健康委员会2025年12月26日新闻发布会文字实录',
      url: 'https://www.nhc.gov.cn/xcs/c100122/202512/9731f93a7e0d451284a0da462527cbd2.shtml',
    },
  ],
} as const;

/** A narrow current-message cue, not a diagnosis or a complete risk assessment. */
export function hasCurrentSelfHarmCue(text: string): boolean {
  // Evaluate clauses independently so a past/negated clause does not hide a
  // separate, explicit present-tense statement. Generic “消失/了结” is not a cue.
  return text.split(/[。！？!?；;\n，,]|但是|可是|不过|但/).some((part) => {
    const clause = part.trim();
    if (!clause) return false;
    if (/(?:不是真的|并不是|不是|并非)(?:真的)?(?:想死|想自杀|想伤害自己)/.test(clause)) return false;
    if (/(?:是什么意思|怎么理解|翻译)/.test(clause) && !/(?:我现在|我真的|我已经|我正在|我今晚)/.test(clause)) return false;
    if (/(?:不想|不会|不打算|没有想|没有要|不再想|不准备|并不想|不愿意)(?:去)?(?:自杀|自残|伤害自己|结束生命|结束自己的生命|死|跳楼|割腕)/.test(clause)) return false;
    if (/(?:以前|曾经|过去|去年|昨天|昨晚|那时|当时|曾想|想过|之前)/.test(clause) && !/(?:现在|此刻|此时|今天|今晚|又想|仍然|还是)/.test(clause)) return false;
    if (/(?:新闻|报道|电影|小说|角色|歌词|文章|讨论|科普|预防|研究)/.test(clause) && !/(?:我现在|我真的|我已经|我正在|我今晚)/.test(clause)) return false;
    if (/(?:他|她|朋友|同事|同学|有人).*(?:说|想|要|准备|打算)/.test(clause) && !/(?:我现在|我真的|我已经|我正在|我今晚)/.test(clause)) return false;
    return /(?:不想活(?:了)?|活不下去|想死|想要死|想自杀|要自杀|准备自杀|打算自杀|正在自残|想自残|想伤害自己|想结束(?:自己的)?生命|要结束(?:自己的)?生命|准备结束(?:自己的)?生命|我(?:现在|已经|正在|今晚)?(?:想|要|准备|打算)(?:跳楼|割腕)|我已经(?:割腕|伤害了自己))/.test(clause);
  });
}

export function getSafetySupportResponse(): string {
  const resource = mainlandPsychologicalSupport;
  return `听到你这样说，我很担心你现在的安全。你此刻是否有伤害自己的打算，或已经受伤？

如果你可能马上行动或已经受伤，请立即联系当地急救服务或前往急诊，也请找一位信任的人现在陪着你，尽可能远离可能伤害自己的物品。

在${resource.region}，可以拨打${resource.name} ${resource.phone}；${resource.availability}。其他地区请联系当地的危机支持服务。

这是预设的安全支持提示，不能替代专业评估或紧急救助。你愿意先告诉我，现在安全吗？`;
}
