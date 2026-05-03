import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Types
// ============================================================

export interface AgentCapability {
    name: string;
    description: string;
    priority: number;
}

export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface AgentConfig {
    id: string;
    name: string;
    icon: string;
    description: string;
    systemPrompt: string;
    capabilities: AgentCapability[];
    tools: AgentTool[];
    handoffTargets: string[];
    preferredModel: 'deepseek' | 'mimo';
    temperature: number;
    collaborationHints: string;
}

export interface AgentContext {
    userId: string;
    conversationId: string;
    shortTermMemory: ShortTermMemory;
    longTermMemory: LongTermMemory;
    userProfile: Record<string, unknown>;
    currentData: Record<string, unknown>;
    parentAgentId?: string;
}

export interface ShortTermMemory {
    recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; agentId?: string }>;
    currentPlan: TaskPlan | null;
    agentOutputs: Map<string, string>;
    reflectionNotes: string[];
}

export interface LongTermMemory {
    userPreferences: Map<string, string>;
    learnedPatterns: Map<string, string>;
    keyFacts: Map<string, string>;
}

export interface TaskPlan {
    id: string;
    intent: string;
    tasks: PlannedTask[];
    status: 'planning' | 'executing' | 'completed' | 'failed';
    createdAt: number;
}

export interface PlannedTask {
    id: string;
    agentId: string;
    agentName: string;
    description: string;
    priority: number;
    dependsOn: string[];
    status: 'pending' | 'running' | 'done' | 'failed';
    result?: string;
}

export interface AgentTraceEntry {
    agentId: string;
    agentName: string;
    agentIcon: string;
    status: 'started' | 'completed' | 'error';
    durationMs: number;
    outputPreview: string;
}

export interface OrchestrationResult {
    content: string;
    agentTrace: AgentTraceEntry[];
    agentCount: number;
    intentAnalysis: {
        primaryIntent: string;
        confidence: number;
        matchedAgents: string[];
    };
}

export interface StreamEvent {
    type: 'conversation' | 'agent_start' | 'agent_end' | 'chunk' | 'tool_call' | 'tool_result' | 'synthesize' | 'done';
    data: Record<string, unknown>;
}

export interface ToolExecutor {
    execute(name: string, args: Record<string, unknown>, context: AgentContext): Promise<unknown>;
}

// ============================================================
// Shared Memory Layer
// ============================================================

export class SharedMemoryLayer {
    private conversations = new Map<string, ShortTermMemory>();
    private profiles = new Map<string, LongTermMemory>();

    getOrCreateShortTerm(conversationId: string): ShortTermMemory {
        if (!this.conversations.has(conversationId)) {
            this.conversations.set(conversationId, {
                recentMessages: [],
                currentPlan: null,
                agentOutputs: new Map(),
                reflectionNotes: [],
            });
        }
        return this.conversations.get(conversationId)!;
    }

    getOrCreateLongTerm(userId: string): LongTermMemory {
        if (!this.profiles.has(userId)) {
            this.profiles.set(userId, {
                userPreferences: new Map(),
                learnedPatterns: new Map(),
                keyFacts: new Map(),
            });
        }
        return this.profiles.get(userId)!;
    }

    clearConversation(conversationId: string): void {
        this.conversations.delete(conversationId);
    }
}

// ============================================================
// Agent Registry
// ============================================================

export class AgentRegistry {
    private agents = new Map<string, AgentConfig>();
    private handoffChains = new Map<string, string[]>();

    register(agent: AgentConfig): void {
        this.agents.set(agent.id, agent);
        this.handoffChains.set(agent.id, [...agent.handoffTargets]);
    }

    get(id: string): AgentConfig | undefined {
        return this.agents.get(id);
    }

    getAll(): AgentConfig[] {
        return Array.from(this.agents.values());
    }

    findByIds(ids: string[]): AgentConfig[] {
        return ids.map((id) => this.agents.get(id)).filter((a): a is AgentConfig => a != null);
    }

    findMatching(intent: string, capabilities: string[]): AgentConfig[] {
        return Array.from(this.agents.values()).filter((agent) => {
            if (agent.id === intent) return true;
            return agent.capabilities.some((cap) => capabilities.includes(cap.name));
        });
    }

    hasHandoff(fromId: string, toId: string): boolean {
        const targets = this.handoffChains.get(fromId);
        return targets ? targets.includes(toId) : false;
    }
}

// ============================================================
// Intent Router
// ============================================================

interface IntentAnalysis {
    primaryIntent: string;
    confidence: number;
    matchedAgents: string[];
    subIntents: Array<{ intent: string; confidence: number }>;
    complexity: 'simple' | 'moderate' | 'complex';
}

export class IntentRouter {
    private patterns: Array<{
        intent: string;
        keywords: string[];
        negativeKeywords: string[];
        priority: number;
        agentIds: string[];
    }> = [
            {
                intent: 'schedule',
                keywords: ['日程', '安排', '提醒', '事件', '会议', '课程', '时间表', '行程', '日历', '几点', '什么时候', '下周', '明天', '后天', '上课', '考试', '作业', 'ddl', 'deadline', '截止'],
                negativeKeywords: [],
                priority: 10,
                agentIds: ['schedule', 'productivity'],
            },
            {
                intent: 'emotion',
                keywords: ['心情', '情绪', '烦恼', '焦虑', '难过', '开心', '沮丧', '压力', '抑郁', 'emo', '安慰', '倾诉', '吐槽', '伤心', '委屈', '烦躁', '心态', '崩溃'],
                negativeKeywords: ['肌肉', '骨折', '扭伤'],
                priority: 10,
                agentIds: ['emotion', 'health'],
            },
            {
                intent: 'health',
                keywords: ['健康', '减肥', '健身', '运动', '跑步', '跳绳', '饮食', '卡路里', '体重', '营养', '睡眠', '身体', '生病', '头疼', '感冒', '锻炼', '拉伸', '瑜伽', '冥想', '体检', '吃', '喝', '瘦', '胖', '肌肉', '深蹲', '卧推'],
                negativeKeywords: [],
                priority: 10,
                agentIds: ['health', 'productivity'],
            },
            {
                intent: 'productivity',
                keywords: ['目标', '习惯', '打卡', '坚持', '效率', '拖延', '计划', '任务', 'todo', '复盘', '总结', '进步', '改进', '自律', '专注', '番茄', 'GTD', '优化', '提升', '监督', '打卡记录', '完成率'],
                negativeKeywords: [],
                priority: 9,
                agentIds: ['productivity', 'health'],
            },
            {
                intent: 'weather',
                keywords: ['天气', '气温', '防晒', '下雨', '空气质量', '雾霾', 'pm2.5', '台风', '降温', '升温', '紫外线', '湿度', '风力', '能见度', '出行建议', '适合户外'],
                negativeKeywords: [],
                priority: 9,
                agentIds: ['weather', 'schedule'],
            },
            {
                intent: 'learning',
                keywords: ['读书', '书单', '笔记', '学习', '技能', '课程推荐', '知识', '阅读', '文章', '教程', '教材', '考证', '考研', '考公', '背单词', '外语', '编程', 'CET', 'TOEFL', '知识体系'],
                negativeKeywords: [],
                priority: 8,
                agentIds: ['learning', 'productivity'],
            },
            {
                intent: 'default',
                keywords: ['你好', '聊天', '闲聊', '陪伴', '介绍', '推荐', '建议', '故事', '笑话', '有趣', '帮忙'],
                negativeKeywords: [],
                priority: 5,
                agentIds: ['default', 'emotion'],
            },
        ];

    analyze(message: string, attachmentFileTypes?: string[]): IntentAnalysis {
        const normalizedMsg = message.toLowerCase();
        const matches: Array<{ intent: string; confidence: number; agentIds: string[] }> = [];

        for (const pattern of this.patterns) {
            if (pattern.intent === 'default') continue;

            let keywordHits = 0;
            let weightedHits = 0;

            for (const kw of pattern.keywords) {
                const matchCount = (normalizedMsg.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
                if (matchCount > 0) {
                    keywordHits += matchCount;
                    weightedHits += matchCount * (kw.length > 1 ? 1 : 0.5);
                }
            }

            let negativeHits = 0;
            for (const nkw of pattern.negativeKeywords) {
                negativeHits += (normalizedMsg.match(new RegExp(nkw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
            }

            if (weightedHits > 0 && negativeHits === 0) {
                const confidence = Math.min(
                    (weightedHits / pattern.keywords.length) * pattern.priority * 0.1,
                    0.95
                );
                matches.push({
                    intent: pattern.intent,
                    confidence,
                    agentIds: pattern.agentIds,
                });
            }
        }

        if (attachmentFileTypes && attachmentFileTypes.length > 0) {
            const existingScores = new Map<string, number>();
            for (const m of matches) {
                existingScores.set(m.intent, m.confidence);
            }

            if (attachmentFileTypes.includes('image') && !existingScores.has('emotion')) {
                matches.push({
                    intent: 'emotion',
                    confidence: 0.4,
                    agentIds: ['emotion'],
                });
            }
            if (attachmentFileTypes.includes('video') && !existingScores.has('journal')) {
                matches.push({
                    intent: 'default',
                    confidence: 0.6,
                    agentIds: ['default', 'emotion'],
                });
            }
        }

        matches.sort((a, b) => b.confidence - a.confidence);

        let primaryIntent = 'default';
        let primaryConfidence = 0.3;
        let matchedAgents: string[] = ['default'];
        const subIntents: Array<{ intent: string; confidence: number }> = [];

        if (matches.length > 0) {
            const top = matches[0];
            if (top.confidence > 0.25) {
                primaryIntent = top.intent;
                primaryConfidence = top.confidence;
                matchedAgents = [...new Set([...top.agentIds, 'default'])];
            }

            for (let i = 1; i < matches.length && i < 4; i++) {
                if (matches[i].confidence > 0.15) {
                    subIntents.push({
                        intent: matches[i].intent,
                        confidence: matches[i].confidence,
                    });
                }
            }
        }

        let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
        if (normalizedMsg.length > 80 || matches.length > 2) {
            complexity = 'moderate';
        }
        if (subIntents.length >= 2 || normalizedMsg.length > 250 || primaryConfidence < 0.4) {
            complexity = 'complex';
        }

        return {
            primaryIntent,
            confidence: primaryConfidence,
            matchedAgents,
            subIntents,
            complexity,
        };
    }
}

// ============================================================
// Task Planner
// ============================================================

export class TaskPlanner {
    decompose(
        intentAnalysis: IntentAnalysis,
        _userMessage: string,
        availableAgents: AgentConfig[]
    ): TaskPlan {
        const plan: TaskPlan = {
            id: uuidv4(),
            intent: intentAnalysis.primaryIntent,
            tasks: [],
            status: 'planning',
            createdAt: Date.now(),
        };

        const mainAgents = intentAnalysis.matchedAgents;
        const executed = new Set<string>();

        for (const agentId of mainAgents) {
            if (executed.has(agentId)) continue;
            const agent = availableAgents.find((a) => a.id === agentId);
            if (!agent) continue;

            plan.tasks.push({
                id: uuidv4(),
                agentId: agent.id,
                agentName: agent.name,
                description: `作为${agent.name}分析用户请求`,
                priority: agent.capabilities.length > 0 ? agent.capabilities[0].priority : 5,
                dependsOn: [],
                status: 'pending',
            });

            executed.add(agentId);
        }

        if (intentAnalysis.subIntents.length > 0) {
            for (const sub of intentAnalysis.subIntents) {
                if (sub.confidence < 0.2) continue;
                const subAgentId = sub.intent;
                if (executed.has(subAgentId)) continue;

                const agent = availableAgents.find((a) => a.id === subAgentId);
                if (!agent) continue;

                plan.tasks.push({
                    id: uuidv4(),
                    agentId: agent.id,
                    agentName: agent.name,
                    description: `辅助分析${sub.intent}相关需求`,
                    priority: Math.round(sub.confidence * 8),
                    dependsOn: [],
                    status: 'pending',
                });

                executed.add(subAgentId);
            }
        }

        if (!executed.has('default')) {
            const defaultAgent = availableAgents.find((a) => a.id === 'default');
            if (defaultAgent) {
                plan.tasks.push({
                    id: uuidv4(),
                    agentId: defaultAgent.id,
                    agentName: defaultAgent.name,
                    description: '通用对话支持',
                    priority: 3,
                    dependsOn: [],
                    status: 'pending',
                });
                executed.add('default');
            }
        }

        if (plan.tasks.length > 1) {
            plan.tasks.sort((a, b) => b.priority - a.priority || a.agentName.localeCompare(b.agentName));
        }

        plan.status = 'executing';
        return plan;
    }
}

// ============================================================
// Critic Agent (Self-Reflection via Reflection Pattern)
// ============================================================

export class CriticAgent {
    async review(
        content: string,
        agentOutputs: Map<string, string>,
        userMessage: string,
        _context: AgentContext
    ): Promise<{ score: number; suggestions: string[]; revisedContent: string }> {
        const reviewPrompt = `作为AI质量控制专家，请审查以下多智能体协作的输出质量：

【用户原始请求】
${userMessage}

【各智能体输出】
${Array.from(agentOutputs.entries()).map(([id, output]) => `[${id}]:\n${output.substring(0, 500)}`).join('\n\n')}

【合成输出】
${content.substring(0, 800)}

请从以下维度评分（每题1-10?
1. 准确性：信息是否正确，数据是否真实
2. 完整性：是否全面回应用户需求
3. 共情力：是否展现情感理解与人文关怀
4. 可操作性：建议是否具体可行
5. 一致性：多智能体输出是否逻辑一致

给出总分(1-10)和具体改进建议。格式：
SCORE: X
SUGGESTIONS:
- 建议1
- 建议2`;

        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

            if (!apiKey) {
                return { score: 7, suggestions: [], revisedContent: content };
            }

            const response = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: '你是AI质量审查专家，严谨客观。' },
                        { role: 'user', content: reviewPrompt },
                    ],
                    max_tokens: 1024,
                    temperature: 0.3,
                }),
            });

            if (!response.ok) {
                return { score: 7, suggestions: [], revisedContent: content };
            }

            const data = await response.json() as { choices: Array<{ message: { content: string } }> };
            const reviewContent = data.choices?.[0]?.message?.content || '';

            const scoreMatch = reviewContent.match(/SCORE:\s*(\d+)/i);
            const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 7;

            const suggestionMatches = reviewContent.match(/SUGGESTIONS:[\s\S]*?(?=\n\n|$)/i);
            const suggestions = suggestionMatches
                ? suggestionMatches[0].split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.trim().replace(/^-\s*/, ''))
                : [];

            return {
                score: Math.min(10, Math.max(1, score)),
                suggestions,
                revisedContent: score >= 7 ? content : content + '\n\n---\n[质量审查：以上内容可能需要进一步优化]',
            };
        } catch {
            return { score: 7, suggestions: [], revisedContent: content };
        }
    }
}

// ============================================================
// Synthesizer
// ============================================================

export class Synthesizer {
    async synthesize(
        agentOutputs: Map<string, string>,
        agentConfigs: Map<string, AgentConfig>,
        userMessage: string,
        _context: AgentContext,
        _trace: AgentTraceEntry[]
    ): Promise<string> {
        if (agentOutputs.size === 1) {
            return Array.from(agentOutputs.values())[0];
        }

        const outputsFormatted = Array.from(agentOutputs.entries())
            .map(([id, output]) => {
                const config = agentConfigs.get(id);
                const name = config?.name || id;
                const icon = config?.icon || '';
                return `### ${icon} ${name}\n${output}`;
            })
            .join('\n\n---\n\n');

        const synthesisPrompt = `作为有迹(Youtrace)的AI核心——你的任务是将以下多个专业智能体的分析结果，融合成一段完整、连贯、充满温度和智慧的回答。

【用户问题】
${userMessage}

【各智能体分析】
${outputsFormatted}

【融合要求】
1. 自然过渡，不要机械罗列「智能体A认为...智能体B认为...?
2. 优先采纳与用户问题直接相关的专业建议
3. 体现深度思考，不只是拼凑信息
4. 展现人格化的温暖陪伴，像一个真正懂用户的朋友
5. 如果多个智能体结论矛盾，以最专业、最可靠的那个为准
6. 给出具体可执行的建议或行动方案
7. 语气亲和但专业，自然融入 emoji（适度使?

请直接输出最终的融合回答，不要提及智能体名称或编号。`;

        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

            if (apiKey) {
                const response = await fetch(`${baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [
                            {
                                role: 'system',
                                content: '你是YouTrace的AI核心，负责将多智能体分析结果融合成温暖、专业、连贯的回答。你的输出直接面向用户，不能机械、不能冷冰冰。',
                            },
                            { role: 'user', content: synthesisPrompt },
                        ],
                        max_tokens: 2048,
                        temperature: 0.7,
                    }),
                });

                if (response.ok) {
                    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
                    const synthContent = data.choices?.[0]?.message?.content;
                    if (synthContent) return synthContent;
                }
            }
        } catch (e) {
            console.warn('Synthesis AI call failed, falling back to basic merge:', (e as Error).message);
        }

        // Fallback: basic merge
        const parts: string[] = [];
        for (const [id, output] of agentOutputs.entries()) {
            const config = agentConfigs.get(id);
            const label = config ? `${config.name}：` : '';
            parts.push(`${label}${output}`);
        }
        return parts.join('\n\n');
    }

    async *synthesizeStream(
        agentOutputs: Map<string, string>,
        agentConfigs: Map<string, AgentConfig>,
        userMessage: string,
        _context: AgentContext,
        _trace: AgentTraceEntry[]
    ): AsyncGenerator<string> {
        if (agentOutputs.size === 1) {
            yield Array.from(agentOutputs.values())[0];
            return;
        }

        const outputsFormatted = Array.from(agentOutputs.entries())
            .map(([id, output]) => {
                const config = agentConfigs.get(id);
                const name = config?.name || id;
                const icon = config?.icon || '';
                return `### ${icon} ${name}\n${output}`;
            })
            .join('\n\n---\n\n');

        const synthesisPrompt = `作为有迹(Youtrace)的AI核心——你的任务是将以下多个专业智能体的分析结果，融合成一段完整、连贯、充满温度和智慧的回答。

【用户问题】
${userMessage}

【各智能体分析】
${outputsFormatted}

【融合要求】
1. 自然过渡，不要机械罗列
2. 优先采纳与用户问题直接相关的专业建议
3. 体现深度思考和人文关怀
4. 展现人格化的温暖陪伴
5. 给出具体可执行的建议
6. 语气亲和但专业

请直接输出最终的融合回答。`;

        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

            if (apiKey) {
                const response = await fetch(`${baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [
                            { role: 'system', content: '你是YouTrace的AI核心，融合多智能体结果输出温暖连贯的回答。' },
                            { role: 'user', content: synthesisPrompt },
                        ],
                        max_tokens: 2048,
                        temperature: 0.7,
                        stream: true,
                    }),
                });

                if (response.ok && response.body) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n');

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data: ')) continue;
                            const jsonStr = trimmed.slice(6);
                            if (jsonStr === '[DONE]') break;
                            try {
                                const parsed = JSON.parse(jsonStr);
                                const delta = parsed.choices?.[0]?.delta?.content;
                                if (delta) yield delta;
                            } catch {
                                // skip parse errors
                            }
                        }
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('Synthesis stream failed:', (e as Error).message);
        }

        // Fallback
        yield Array.from(agentOutputs.values()).join('\n\n');
    }
}

// ============================================================
// Expert Agent Factory (Core Execution Engine)
// ============================================================

export class ExpertAgentFactory {
    private openaiCache = new Map<string, OpenAI>();

    private getOpenAI(model: string): OpenAI {
        if (this.openaiCache.has(model)) {
            return this.openaiCache.get(model)!;
        }

        let apiKey: string;
        let baseURL: string;

        switch (model) {
            case 'deepseek':
                apiKey = process.env.DEEPSEEK_API_KEY || '';
                baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
                break;
            case 'mimo':
                apiKey = process.env.MIMO_API_KEY || '';
                baseURL = process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';
                break;
            default:
                apiKey = process.env.DEEPSEEK_API_KEY || '';
                baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
        }

        const client = new OpenAI({
            apiKey,
            baseURL: `${baseURL}/v1`,
        });

        this.openaiCache.set(model, client);
        return client;
    }

    private getModelName(preferredModel: string): string {
        switch (preferredModel) {
            case 'deepseek':
                return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
            case 'mimo':
                return process.env.MIMO_MODEL || 'mimo-v2.5';
            default:
                return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        }
    }

    async executeAgent(
        agent: AgentConfig,
        userMessage: string,
        context: AgentContext,
        toolExecutor: ToolExecutor,
        otherAgentOutputs?: Map<string, string>
    ): Promise<string> {
        const model = this.getModelName(agent.preferredModel);
        const openai = this.getOpenAI(agent.preferredModel);

        const systemPrompt = this.buildSystemPrompt(agent, context, otherAgentOutputs);

        interface ChatMessage {
            role: 'system' | 'user' | 'assistant' | 'tool';
            content: string;
            tool_call_id?: string;
            tool_calls?: Array<{
                id: string;
                type: 'function';
                function: { name: string; arguments: string };
            }>;
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
        ];

        for (const msg of context.shortTermMemory.recentMessages.slice(-10)) {
            messages.push({ role: msg.role, content: msg.content });
        }

        messages.push({
            role: 'user',
            content: `【用户最新请求 - 请认真处理】\n${userMessage}`,
        });

        const MAX_ROUNDS = 8;
        let finalContent = '';

        for (let round = 0; round < MAX_ROUNDS; round++) {
            const tools = agent.tools.map((t) => ({
                type: 'function' as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as Record<string, unknown>,
                },
            }));

            const completion = await openai.chat.completions.create({
                model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                tools: tools.length > 0 ? tools : undefined,
                temperature: agent.temperature,
                max_tokens: 2048,
            });

            const choice = completion.choices?.[0];
            if (!choice?.message) {
                finalContent = finalContent || 'AI暂时无法回应，请稍后再试。';
                break;
            }

            const msg = choice.message;

            if (msg.content) {
                finalContent += msg.content;
            }

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                break;
            }

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: msg.content || '',
                tool_calls: [],
            };

            const toolCallResults: Array<{ tool_call_id: string; role: 'tool'; content: string }> = [];

            for (const tc of msg.tool_calls) {
                if (tc.type !== 'function' || !tc.function) continue;

                const functionName = tc.function.name;
                let functionArgs: Record<string, unknown> = {};

                try {
                    functionArgs = JSON.parse(tc.function.arguments || '{}');
                } catch {
                    functionArgs = {};
                }

                assistantMsg.tool_calls?.push({
                    id: tc.id,
                    type: 'function',
                    function: { name: functionName, arguments: tc.function.arguments },
                });

                try {
                    const result = await toolExecutor.execute(functionName, functionArgs, context);
                    toolCallResults.push({
                        tool_call_id: tc.id,
                        role: 'tool',
                        content: JSON.stringify(result),
                    });
                } catch (toolError) {
                    toolCallResults.push({
                        tool_call_id: tc.id,
                        role: 'tool',
                        content: JSON.stringify({ error: `工具执行失败: ${(toolError as Error).message}` }),
                    });
                }
            }

            if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
                messages.push(assistantMsg);

                for (const tr of toolCallResults) {
                    messages.push(tr);
                }
            }

            if (toolCallResults.length === 0 && !msg.content) {
                break;
            }
        }

        return finalContent || '处理中...';
    }

    async *executeAgentStream(
        agent: AgentConfig,
        userMessage: string,
        context: AgentContext,
        toolExecutor: ToolExecutor,
        otherAgentOutputs?: Map<string, string>
    ): AsyncGenerator<{ type: 'chunk' | 'tool_call' | 'tool_result'; content?: string; toolName?: string; toolArgs?: Record<string, unknown>; toolResult?: unknown }> {
        const model = this.getModelName(agent.preferredModel);

        const tools = agent.tools.map((t) => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters as Record<string, unknown>,
            },
        }));

        const systemPrompt = this.buildSystemPrompt(agent, context, otherAgentOutputs);

        interface StreamMessage {
            role: 'system' | 'user' | 'assistant' | 'tool';
            content: string;
            tool_call_id?: string;
            tool_calls?: Array<{
                id: string;
                type: 'function';
                function: { name: string; arguments: string };
            }>;
        }

        const messages: StreamMessage[] = [
            { role: 'system', content: systemPrompt },
        ];

        for (const msg of context.shortTermMemory.recentMessages.slice(-10)) {
            messages.push({ role: msg.role, content: msg.content });
        }

        messages.push({
            role: 'user',
            content: `【用户最新请求 - 请认真处理】\n${userMessage}`,
        });

        const MAX_ROUNDS = 8;
        let fullContent = '';
        const toolCallsAccumulator = new Map<number, { id: string; name: string; args: string }>();

        for (let round = 0; round < MAX_ROUNDS; round++) {
            const streamUrl = agent.preferredModel === 'deepseek'
                ? `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`
                : `${process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1'}/chat/completions`;

            const apiKey = agent.preferredModel === 'deepseek'
                ? process.env.DEEPSEEK_API_KEY || ''
                : process.env.MIMO_API_KEY || '';

            if (!apiKey) {
                // Fallback to non-streaming
                const result = await this.executeAgent(agent, userMessage, context, toolExecutor, otherAgentOutputs);
                yield { type: 'chunk', content: result };
                return;
            }

            const response = await fetch(streamUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
                        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
                    })),
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: agent.temperature,
                    max_tokens: 2048,
                    stream: true,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => '');
                console.error(`Stream API error for ${agent.id}: ${response.status} ${errorBody}`);
                if (fullContent) {
                    return;
                }
                throw new Error(`AI stream failed (${agent.preferredModel}): ${response.status}`);
            }

            if (!response.body) {
                if (fullContent) return;
                throw new Error('AI stream returned empty body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            fullContent = '';
            toolCallsAccumulator.clear();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.slice(6);
                    if (jsonStr === '[DONE]') break;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta;

                        if (!delta) continue;

                        if (delta.content) {
                            fullContent += delta.content;
                            yield { type: 'chunk', content: delta.content };
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index || 0;
                                if (!toolCallsAccumulator.has(idx)) {
                                    toolCallsAccumulator.set(idx, {
                                        id: tc.id || uuidv4(),
                                        name: tc.function?.name || '',
                                        args: '',
                                    });
                                }
                                const acc = toolCallsAccumulator.get(idx)!;
                                if (tc.id) acc.id = tc.id;
                                if (tc.function?.name) acc.name = tc.function.name;
                                if (tc.function?.arguments) acc.args += tc.function.arguments;
                            }
                        }
                    } catch {
                        // skip malformed
                    }
                }
            }

            if (toolCallsAccumulator.size > 0) {
                messages.push({
                    role: 'assistant',
                    content: fullContent || '',
                    tool_calls: Array.from(toolCallsAccumulator.values()).map((tc) => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: tc.args },
                    })),
                });

                for (const tc of toolCallsAccumulator.values()) {
                    yield { type: 'tool_call', toolName: tc.name, toolArgs: JSON.parse(tc.args || '{}') };
                    try {
                        const args = JSON.parse(tc.args || '{}');
                        const result = await toolExecutor.execute(tc.name, args, context);
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify(result),
                        });
                        yield { type: 'tool_result', toolName: tc.name, toolResult: result };
                    } catch {
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify({ error: '工具执行失败' }),
                        });
                        yield { type: 'tool_result', toolName: tc.name, toolResult: { error: '工具执行失败' } };
                    }
                }

                fullContent = '';
                toolCallsAccumulator.clear();
            } else {
                return;
            }
        }
    }

    private buildSystemPrompt(
        agent: AgentConfig,
        context: AgentContext,
        otherAgentOutputs?: Map<string, string>
    ): string {
        const parts: string[] = [];

        const now = new Date();
        const tzOffset = 8;
        const cstNow = new Date(now.getTime() + tzOffset * 3600000);
        const timeStr = cstNow.toISOString().replace('T', ' ').slice(0, 19);
        const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][cstNow.getUTCDay()];

        parts.push(`【系统时间锚点 - 你无法通过工具获取，必须牢记】`);
        parts.push(`现在时间是: ${timeStr} (北京时间/中国标准时间 CST+8)`);
        parts.push(`今天是: 星期${dayOfWeek}`);
        parts.push(`当前日期: ${cstNow.toISOString().slice(0, 10)}`);
        parts.push(`时间是你最重要的参考锚点——所有"今天""明天""还有多久"的判断必须以此为准，严禁臆测。`);
        parts.push('');

        parts.push(`你是「${agent.icon} ${agent.name}」— ${agent.description}`);
        parts.push('');
        parts.push(agent.systemPrompt);
        parts.push('');

        parts.push('---');
        parts.push('【当前用户数据上下文 - 最新数据，优先使用】');
        if (context.currentData && typeof context.currentData === 'object' && Object.keys(context.currentData).length > 0) {
            parts.push(formatContextData(context.currentData));
        } else {
            parts.push('（暂无加载的上下文数据，请使用工具获取实时数据）');
        }
        parts.push('');

        if (context.userProfile && typeof context.userProfile === 'object' && Object.keys(context.userProfile).length > 0) {
            parts.push('---');
            parts.push('【用户画像 - 已深度了解用户】');
            parts.push(formatUserProfile(context.userProfile));
            parts.push('');
        }

        if (otherAgentOutputs && otherAgentOutputs.size > 0) {
            const otherEntries = Array.from(otherAgentOutputs.entries())
                .filter(([id]) => id !== agent.id);
            if (otherEntries.length > 0) {
                parts.push('---');
                parts.push('【其他专家智能体分析 - 协作参考】');
                for (const [otherId, output] of otherEntries) {
                    parts.push(`[${otherId}]: ${output.substring(0, 600)}`);
                }
                parts.push('');
            }
        }

        parts.push('---');
        parts.push('【协作协议】');
        parts.push(agent.collaborationHints);
        parts.push('');
        parts.push('硬性规则：');
        parts.push('1. 所有数据必须来自上下文或工具调用，严禁编造');
        parts.push('2. 需要实时数据时必须调用工具');
        parts.push('3. 超出专业领域标注 [HANDOFF:目标AgentId]');
        parts.push('4. 专业洞察+温暖关怀的语气');
        parts.push('5. 给出具体可执行的建议，拒绝空洞套话');

        return parts.join('\n');
    }
}

function formatContextData(data: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            lines.push(`${key}: ${value}`);
        } else if (value && typeof value === 'object') {
            lines.push(`${key}:`);
            lines.push(JSON.stringify(value, null, 1));
        }
    }
    return lines.join('\n') || JSON.stringify(data, null, 2);
}

function formatUserProfile(profile: Record<string, unknown>): string {
    const entries = Object.entries(profile).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}

// ============================================================
// Agent Orchestrator (Core Engine)
// ============================================================

export class AgentOrchestrator {
    readonly router = new IntentRouter();
    readonly registry = new AgentRegistry();
    readonly memory = new SharedMemoryLayer();
    readonly planner = new TaskPlanner();
    readonly critic = new CriticAgent();
    readonly synthesizer = new Synthesizer();
    readonly factory = new ExpertAgentFactory();

    registerAgent(agent: AgentConfig): void {
        this.registry.register(agent);
    }

    async orchestrate(
        userId: string,
        conversationId: string,
        userMessage: string,
        toolExecutor: ToolExecutor,
        attachmentFileTypes?: string[],
        userProfile?: Record<string, unknown>,
        currentData?: Record<string, unknown>
    ): Promise<OrchestrationResult> {
        const trace: AgentTraceEntry[] = [];

        // === Phase 1: Intent Analysis ===
        const intentAnalysis = this.router.analyze(userMessage, attachmentFileTypes);

        const shortTerm = this.memory.getOrCreateShortTerm(conversationId);
        const longTerm = this.memory.getOrCreateLongTerm(userId);

        const context: AgentContext = {
            userId,
            conversationId,
            shortTermMemory: shortTerm,
            longTermMemory: longTerm,
            userProfile: userProfile || {},
            currentData: currentData || {},
        };

        // === Phase 2: Task Planning ===
        let plan: TaskPlan | null = null;
        let matchedAgents: AgentConfig[] = [];

        if (intentAnalysis.complexity !== 'simple' || intentAnalysis.confidence < 0.6) {
            matchedAgents = this.registry.findByIds(intentAnalysis.matchedAgents);

            if (intentAnalysis.subIntents.length > 0) {
                for (const sub of intentAnalysis.subIntents) {
                    const subAgent = this.registry.get(sub.intent);
                    if (subAgent && !matchedAgents.some((a) => a.id === subAgent.id)) {
                        matchedAgents.push(subAgent);
                    }
                }
            }

            plan = this.planner.decompose(intentAnalysis, userMessage, matchedAgents);
            shortTerm.currentPlan = plan;
        } else {
            matchedAgents = this.registry.findByIds(intentAnalysis.matchedAgents);
        }

        // Ensure default agent is available
        const defaultAgent = this.registry.get('default');
        if (defaultAgent && !matchedAgents.some((a) => a.id === 'default')) {
            matchedAgents.push(defaultAgent);
        }

        if (matchedAgents.length === 0) {
            matchedAgents = this.registry.getAll().filter((a) => a.id === 'default');
        }

        // Limit agents to prevent token explosion
        if (matchedAgents.length > 4) {
            matchedAgents = matchedAgents.slice(0, 4);
        }

        // === Phase 3: Parallel Agent Execution ===
        const agentOutputs = new Map<string, string>();
        const agentConfigs = new Map<string, AgentConfig>();

        for (const agent of matchedAgents) {
            agentConfigs.set(agent.id, agent);
        }

        // Sequential execution to ensure quality
        for (const agent of matchedAgents) {
            const agentStart = Date.now();
            trace.push({
                agentId: agent.id,
                agentName: agent.name,
                agentIcon: agent.icon,
                status: 'started',
                durationMs: 0,
                outputPreview: '',
            });

            try {
                const output = await this.factory.executeAgent(
                    agent,
                    userMessage,
                    context,
                    toolExecutor,
                    agentOutputs.size > 0 ? agentOutputs : undefined
                );

                agentOutputs.set(agent.id, output);

                const entry = trace[trace.length - 1];
                entry.status = 'completed';
                entry.durationMs = Date.now() - agentStart;
                entry.outputPreview = output.substring(0, 100);
            } catch (err) {
                const entry = trace[trace.length - 1];
                entry.status = 'error';
                entry.durationMs = Date.now() - agentStart;
                entry.outputPreview = `错误: ${(err as Error).message}`;
                console.error(`Agent ${agent.id} failed:`, (err as Error).message);
            }
        }

        // === Phase 4: Critic Review (complex queries only) ===
        let finalContent: string;

        if (agentOutputs.size === 1) {
            finalContent = Array.from(agentOutputs.values())[0];
        } else {
            finalContent = await this.synthesizer.synthesize(
                agentOutputs,
                agentConfigs,
                userMessage,
                context,
                trace
            );

            // Run critic for complex or multi-agent outputs
            if (intentAnalysis.complexity === 'complex' || agentOutputs.size > 2) {
                try {
                    const review = await this.critic.review(
                        finalContent,
                        agentOutputs,
                        userMessage,
                        context
                    );

                    if (review.score < 6 && review.suggestions.length > 0) {
                        shortTerm.reflectionNotes.push(
                            `[${new Date().toISOString()}] Criticscore=${review.score}, suggestions=${review.suggestions.join('; ')}`
                        );
                    }
                } catch {
                    // Critic failure is non-fatal
                }
            }
        }

        // Update memory
        shortTerm.recentMessages.push({ role: 'user', content: userMessage });
        shortTerm.recentMessages.push({ role: 'assistant', content: finalContent });
        if (shortTerm.recentMessages.length > 30) {
            shortTerm.recentMessages = shortTerm.recentMessages.slice(-30);
        }

        if (plan) {
            plan.status = 'completed';
        }

        return {
            content: finalContent,
            agentTrace: trace,
            agentCount: agentOutputs.size,
            intentAnalysis: {
                primaryIntent: intentAnalysis.primaryIntent,
                confidence: intentAnalysis.confidence,
                matchedAgents: intentAnalysis.matchedAgents,
            },
        };
    }

    async *orchestrateStream(
        userId: string,
        conversationId: string,
        userMessage: string,
        toolExecutor: ToolExecutor,
        attachmentFileTypes?: string[],
        userProfile?: Record<string, unknown>,
        currentData?: Record<string, unknown>
    ): AsyncGenerator<StreamEvent> {
        const trace: AgentTraceEntry[] = [];

        // === Phase 1: Intent Analysis ===
        const intentAnalysis = this.router.analyze(userMessage, attachmentFileTypes);

        const shortTerm = this.memory.getOrCreateShortTerm(conversationId);
        const longTerm = this.memory.getOrCreateLongTerm(userId);

        const context: AgentContext = {
            userId,
            conversationId,
            shortTermMemory: shortTerm,
            longTermMemory: longTerm,
            userProfile: userProfile || {},
            currentData: currentData || {},
        };

        // === Phase 2: Task Planning ===
        let matchedAgents: AgentConfig[] = this.registry.findByIds(intentAnalysis.matchedAgents);
        let plan: TaskPlan | null = null;

        if (intentAnalysis.complexity !== 'simple' || intentAnalysis.confidence < 0.6) {
            if (intentAnalysis.subIntents.length > 0) {
                for (const sub of intentAnalysis.subIntents) {
                    const subAgent = this.registry.get(sub.intent);
                    if (subAgent && !matchedAgents.some((a) => a.id === subAgent.id)) {
                        matchedAgents.push(subAgent);
                    }
                }
            }

            plan = this.planner.decompose(intentAnalysis, userMessage, matchedAgents);
            shortTerm.currentPlan = plan;
        }

        const defaultAgent = this.registry.get('default');
        if (defaultAgent && !matchedAgents.some((a) => a.id === 'default')) {
            matchedAgents.push(defaultAgent);
        }

        if (matchedAgents.length === 0) {
            matchedAgents = this.registry.getAll().filter((a) => a.id === 'default');
        }

        if (matchedAgents.length > 4) {
            matchedAgents = matchedAgents.slice(0, 4);
        }

        // Yield conversation info
        yield {
            type: 'conversation',
            data: {
                conversationId,
                agentCount: matchedAgents.length,
                primaryIntent: intentAnalysis.primaryIntent,
                confidence: intentAnalysis.confidence,
                agents: matchedAgents.map((a) => ({ id: a.id, name: a.name, icon: a.icon })),
            },
        };

        // === Phase 3: Sequential Agent Execution with Streaming ===
        const agentOutputs = new Map<string, string>();
        const agentConfigs = new Map<string, AgentConfig>();

        for (const agent of matchedAgents) {
            agentConfigs.set(agent.id, agent);
        }

        for (const agent of matchedAgents) {
            const agentStart = Date.now();

            yield {
                type: 'agent_start',
                data: { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon },
            };

            try {
                let firstChunk = true;

                for await (const event of this.factory.executeAgentStream(
                    agent,
                    userMessage,
                    context,
                    toolExecutor,
                    agentOutputs.size > 0 ? agentOutputs : undefined
                )) {
                    if (event.type === 'chunk' && event.content) {
                        if (firstChunk) {
                            firstChunk = false;
                        }
                        agentOutputs.set(
                            agent.id,
                            (agentOutputs.get(agent.id) || '') + event.content
                        );
                        yield {
                            type: 'chunk',
                            data: { agentId: agent.id, agentName: agent.name, agentIcon: agent.icon, content: event.content },
                        };
                    }

                    if (event.type === 'tool_call') {
                        yield {
                            type: 'tool_call',
                            data: {
                                agentId: agent.id,
                                agentName: agent.name,
                                toolName: event.toolName,
                                toolArgs: event.toolArgs,
                            },
                        };
                    }

                    if (event.type === 'tool_result') {
                        yield {
                            type: 'tool_result',
                            data: {
                                agentId: agent.id,
                                agentName: agent.name,
                                toolName: event.toolName,
                                toolResult: event.toolResult,
                            },
                        };
                    }
                }

                trace.push({
                    agentId: agent.id,
                    agentName: agent.name,
                    agentIcon: agent.icon,
                    status: 'completed',
                    durationMs: Date.now() - agentStart,
                    outputPreview: (agentOutputs.get(agent.id) || '').substring(0, 100),
                });

                yield {
                    type: 'agent_end',
                    data: {
                        agentId: agent.id,
                        agentName: agent.name,
                        agentIcon: agent.icon,
                        status: 'completed',
                        durationMs: Date.now() - agentStart,
                    },
                };
            } catch (err) {
                trace.push({
                    agentId: agent.id,
                    agentName: agent.name,
                    agentIcon: agent.icon,
                    status: 'error',
                    durationMs: Date.now() - agentStart,
                    outputPreview: `Error: ${(err as Error).message}`,
                });

                yield {
                    type: 'agent_end',
                    data: {
                        agentId: agent.id,
                        agentName: agent.name,
                        agentIcon: agent.icon,
                        status: 'error',
                        error: (err as Error).message,
                    },
                };
                console.error(`Agent ${agent.id} stream failed:`, (err as Error).message);
            }
        }

        // === Phase 4 & 5: Synthesize + Done ===
        if (agentOutputs.size > 1) {
            yield { type: 'synthesize', data: { agentCount: agentOutputs.size } };

            let synthContent = '';
            for await (const chunk of this.synthesizer.synthesizeStream(
                agentOutputs,
                agentConfigs,
                userMessage,
                context,
                trace
            )) {
                synthContent += chunk;
                yield { type: 'chunk', data: { agentId: 'synthesizer', agentName: 'AI核心', agentIcon: '', content: chunk } };
            }

            shortTerm.recentMessages.push({ role: 'user', content: userMessage });
            shortTerm.recentMessages.push({ role: 'assistant', content: synthContent });
            if (shortTerm.recentMessages.length > 30) {
                shortTerm.recentMessages = shortTerm.recentMessages.slice(-30);
            }

            yield {
                type: 'done',
                data: {
                    agentTrace: trace,
                    agentCount: agentOutputs.size,
                    content: synthContent,
                },
            };
        } else {
            const finalContent = Array.from(agentOutputs.values()).join('\n');

            shortTerm.recentMessages.push({ role: 'user', content: userMessage });
            shortTerm.recentMessages.push({ role: 'assistant', content: finalContent });
            if (shortTerm.recentMessages.length > 30) {
                shortTerm.recentMessages = shortTerm.recentMessages.slice(-30);
            }

            yield {
                type: 'done',
                data: {
                    agentTrace: trace,
                    agentCount: agentOutputs.size,
                    content: finalContent,
                },
            };
        }

        if (plan) {
            plan.status = 'completed';
        }
    }
}

// Global singleton
export const agentOrchestrator = new AgentOrchestrator();
