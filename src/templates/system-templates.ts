import type {
  SessionTemplateStatus,
  SessionTopic,
  SessionType,
  SurveyResponseType,
} from '@pulsefeedback/shared';

/**
 * Built-in (system) session templates. Seeded with orgId = null and
 * visibility = 'system', so they are read-only for every org — duplicate
 * one to customize it.
 *
 * Rollout plan: the 12 "Core" templates are published first; the remaining
 * 38 ship as drafts grouped into themed packs that can be published later.
 */

export const CORE_PACK = 'Core';
export const DRAFT_PACKS = [
  'Culture & Inclusion Pack',
  'Growth & Learning Pack',
  'Wellbeing & Retention Pack',
  'Team Effectiveness Pack',
  'Operations & Change Pack',
  'Innovation & AI Pack',
] as const;
type Pack = typeof CORE_PACK | (typeof DRAFT_PACKS)[number];

/**
 * Fields the seed may fill in on an existing system template when they are
 * missing. Content fields (name, description, topics…) are never touched.
 */
export const SYSTEM_TEMPLATE_METADATA_KEYS = [
  'category',
  'tags',
  'audience',
  'estimatedDurationMinutes',
  'visibility',
  'createdBy',
  'version',
  'status',
  'rolloutSuggestion',
  'pack',
] as const;

export interface SystemTemplateDef {
  name: string;
  description: string;
  sessionType: SessionType;
  goalPrompt: string;
  tone: 'supportive' | 'neutral' | 'direct';
  topics: SessionTopic[];
  category: string;
  tags: string[];
  audience: string;
  estimatedDurationMinutes: number;
  status: Extract<SessionTemplateStatus, 'draft' | 'published'>;
  pack: Pack;
  rolloutSuggestion: string;
}

// ---- Survey question helpers -------------------------------------------

type Question = {
  title: string;
  responseType: SurveyResponseType;
  options?: string[];
};

const AGREE = [
  'Strongly disagree',
  'Disagree',
  'Neutral',
  'Agree',
  'Strongly agree',
];
const FREQUENCY = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
const RATING = ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];
const MOOD = ['Very low', 'Low', 'Okay', 'Good', 'Great'];

const scale = (title: string, options: string[] = AGREE): Question => ({
  title,
  responseType: 'scale',
  options,
});
const choice = (title: string, options: string[]): Question => ({
  title,
  responseType: 'multiple_choice',
  options,
});
const yesNo = (title: string): Question => ({ title, responseType: 'yes_no' });
const text = (title: string): Question => ({ title, responseType: 'text' });

const toTopics = (items: Array<string | Question>): SessionTopic[] =>
  items.map((item, i) =>
    typeof item === 'string'
      ? { id: `t${i + 1}`, title: item, order: i + 1 }
      : { id: `t${i + 1}`, order: i + 1, ...item },
  );

type Meta = Pick<
  SystemTemplateDef,
  | 'category'
  | 'tags'
  | 'audience'
  | 'estimatedDurationMinutes'
  | 'pack'
  | 'rolloutSuggestion'
>;

const statusFor = (pack: Pack) =>
  pack === CORE_PACK ? ('published' as const) : ('draft' as const);

function survey(
  name: string,
  description: string,
  questions: Question[],
  meta: Meta,
): SystemTemplateDef {
  return {
    name,
    description,
    sessionType: 'survey',
    goalPrompt: description,
    tone: 'neutral',
    topics: toTopics(questions),
    status: statusFor(meta.pack),
    ...meta,
  };
}

function oneOnOne(
  name: string,
  description: string,
  topics: string[],
  meta: Meta,
): SystemTemplateDef {
  return {
    name,
    description,
    sessionType: 'one_on_one',
    goalPrompt: description,
    tone: 'supportive',
    topics: toTopics(topics),
    status: statusFor(meta.pack),
    ...meta,
  };
}

// ---- Templates -----------------------------------------------------------

export const SYSTEM_SESSION_TEMPLATES: SystemTemplateDef[] = [
  // Surveys
  survey(
    'Employee Engagement Pulse',
    'Measure employee engagement, satisfaction, and commitment.',
    [
      scale('Overall engagement'),
      scale('Motivation at work'),
      scale('Organizational commitment'),
      text('Suggestions for improvement'),
    ],
    {
      category: 'Engagement',
      tags: ['engagement', 'pulse', 'retention'],
      audience: 'All employees',
      estimatedDurationMinutes: 8,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Run quarterly across the whole organization to establish an engagement baseline and track trends.',
    },
  ),
  survey(
    'Weekly Team Pulse',
    'Check how the team is feeling each week.',
    [
      scale('Weekly mood', MOOD),
      scale('Progress and wins'),
      yesNo('Current blockers'),
      text('Support needed'),
    ],
    {
      category: 'Engagement',
      tags: ['pulse', 'weekly', 'team'],
      audience: 'Team members',
      estimatedDurationMinutes: 3,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Send every Friday to one team; keep it short and share the results in the next team meeting.',
    },
  ),
  survey(
    'Workload & Burnout Check',
    'Understand workload sustainability and potential burnout risks.',
    [
      scale('Workload manageability'),
      scale('Stress levels', FREQUENCY),
      scale('Work-life balance', RATING),
      text('Support or changes needed'),
    ],
    {
      category: 'Wellbeing',
      tags: ['workload', 'burnout', 'wellbeing'],
      audience: 'All employees',
      estimatedDurationMinutes: 6,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Run monthly during busy periods, or after major deadlines; follow up with managers on high-risk teams.',
    },
  ),
  survey(
    'Psychological Safety',
    'Understand whether employees feel safe speaking up and sharing ideas.',
    [
      scale('Comfort speaking up'),
      scale('Response to mistakes'),
      scale('Ability to disagree'),
      text('Suggestions for greater safety'),
    ],
    {
      category: 'Culture',
      tags: ['psychological safety', 'trust', 'team'],
      audience: 'All employees',
      estimatedDurationMinutes: 6,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Run twice a year per team; keep responses anonymous and review results with team leads.',
    },
  ),
  survey(
    'Manager Effectiveness',
    'Gather feedback on manager support, communication, and effectiveness.',
    [
      scale('Clarity of expectations'),
      scale('Coaching and support'),
      scale('Feedback quality', RATING),
      text('Areas for improvement'),
    ],
    {
      category: 'Management',
      tags: ['manager', 'leadership', 'upward feedback'],
      audience: 'Direct reports',
      estimatedDurationMinutes: 7,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Run every six months for managers with at least three direct reports to protect anonymity.',
    },
  ),
  survey(
    'Onboarding Experience',
    "Understand new hires' onboarding experience and support needs.",
    [
      scale('Role clarity'),
      scale('Tools and resources', RATING),
      scale('Team integration'),
      text('Onboarding improvements'),
    ],
    {
      category: 'Onboarding',
      tags: ['onboarding', 'new hire'],
      audience: 'New hires (first 60 days)',
      estimatedDurationMinutes: 6,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Trigger automatically around day 30 for each new hire; review themes monthly with HR.',
    },
  ),
  survey(
    'Belonging & Inclusion',
    "Understand employees' sense of belonging and inclusion.",
    [
      scale('Sense of belonging'),
      scale('Respectful treatment'),
      scale('Fair access to opportunities'),
      text('Suggestions for inclusion'),
    ],
    {
      category: 'Culture',
      tags: ['belonging', 'inclusion', 'dei'],
      audience: 'All employees',
      estimatedDurationMinutes: 6,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Run annually alongside the engagement survey; keep results aggregated to protect anonymity.',
    },
  ),
  survey(
    'Recognition & Appreciation',
    'Understand whether employees feel their contributions are recognized.',
    [
      scale('Recognition frequency', FREQUENCY),
      scale('Recognition fairness'),
      choice('Preferred recognition', [
        'Public shout-out',
        'Private thanks',
        'Written note',
        'Growth opportunity',
        'Reward or bonus',
      ]),
      text('Ideas for improvement'),
    ],
    {
      category: 'Culture',
      tags: ['recognition', 'appreciation'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Run twice a year and share preferred recognition styles with managers.',
    },
  ),
  survey(
    'Career Growth & Development',
    'Understand career aspirations and access to development opportunities.',
    [
      scale('Career clarity'),
      scale('Learning opportunities'),
      scale('Growth support'),
      text('Development priorities'),
    ],
    {
      category: 'Growth & Development',
      tags: ['career', 'growth', 'development'],
      audience: 'All employees',
      estimatedDurationMinutes: 6,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Run before annual planning or review cycles to inform development budgets.',
    },
  ),
  survey(
    'Change Readiness',
    'Assess employee understanding and readiness for organizational change.',
    [
      scale('Understanding of change'),
      scale('Confidence in the plan'),
      text('Concerns and risks'),
      text('Support needed'),
    ],
    {
      category: 'Change Management',
      tags: ['change', 'readiness', 'transformation'],
      audience: 'Employees affected by a change',
      estimatedDurationMinutes: 6,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Send shortly after a change is announced, then again 4–6 weeks later to measure progress.',
    },
  ),
  survey(
    'Meeting Effectiveness',
    'Evaluate whether meetings are useful, inclusive, and productive.',
    [
      scale('Meeting purpose'),
      scale('Preparation and participation'),
      scale('Decision clarity'),
      text('Ways to improve meetings'),
    ],
    {
      category: 'Team Effectiveness',
      tags: ['meetings', 'productivity'],
      audience: 'Team members',
      estimatedDurationMinutes: 4,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Run once per quarter for teams with heavy meeting loads; pair with a calendar audit.',
    },
  ),
  survey(
    'Remote & Hybrid Work',
    'Understand how remote and hybrid work arrangements are working.',
    [
      scale('Work arrangement effectiveness'),
      scale('Communication', RATING),
      scale('Collaboration', RATING),
      text('Resources needed'),
    ],
    {
      category: 'Wellbeing',
      tags: ['remote', 'hybrid', 'flexibility'],
      audience: 'Remote and hybrid employees',
      estimatedDurationMinutes: 5,
      pack: 'Wellbeing & Retention Pack',
      rolloutSuggestion:
        'Run twice a year or after any change to office or remote-work policy.',
    },
  ),
  survey(
    'Cross-functional Collaboration',
    'Identify strengths and friction in cross-team collaboration.',
    [
      scale('Cross-team communication', RATING),
      scale('Ownership clarity'),
      scale('Handoffs and dependencies', RATING),
      text('Improvements needed'),
    ],
    {
      category: 'Team Effectiveness',
      tags: ['collaboration', 'cross-functional'],
      audience: 'Employees working across teams',
      estimatedDurationMinutes: 6,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Run after major cross-team projects or semi-annually across departments.',
    },
  ),
  survey(
    'Communication Clarity',
    'Assess clarity, timeliness, and usefulness of workplace communication.',
    [
      scale('Clarity of messages'),
      scale('Timeliness'),
      scale('Access to information'),
      text('Communication improvements'),
    ],
    {
      category: 'Communication',
      tags: ['communication', 'transparency'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Run twice a year, or after launching a new internal communication channel.',
    },
  ),
  survey(
    'Values in Action',
    'Understand how consistently organizational values are demonstrated.',
    [
      scale('Values understood'),
      scale('Values demonstrated', FREQUENCY),
      text('Examples from work'),
      text('Gaps or suggestions'),
    ],
    {
      category: 'Culture',
      tags: ['values', 'culture'],
      audience: 'All employees',
      estimatedDurationMinutes: 7,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Run annually, ideally before values or culture refresh workshops.',
    },
  ),
  survey(
    'Customer Feedback Culture',
    'Understand how customer feedback is collected and used.',
    [
      scale('Access to customer feedback'),
      scale('Use in decisions', FREQUENCY),
      scale('Cross-team sharing', FREQUENCY),
      text('Improvements needed'),
    ],
    {
      category: 'Operations',
      tags: ['customer', 'feedback', 'decision-making'],
      audience: 'Customer-facing and product teams',
      estimatedDurationMinutes: 5,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Run semi-annually with product, support, and sales teams.',
    },
  ),
  survey(
    'Learning & Training Needs',
    'Identify skill gaps and learning priorities.',
    [
      text('Current skill gaps'),
      text('Priority skills'),
      choice('Useful learning formats', [
        'Live workshops',
        'Self-paced courses',
        'Mentoring',
        'On-the-job projects',
        'Conferences',
      ]),
      text('Training requests'),
    ],
    {
      category: 'Growth & Development',
      tags: ['learning', 'training', 'skills'],
      audience: 'All employees',
      estimatedDurationMinutes: 7,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Run annually before learning and development budget planning.',
    },
  ),
  survey(
    'Wellbeing & Support',
    'Understand employee wellbeing and awareness of available support.',
    [
      scale('Wellbeing at work', MOOD),
      scale('Support accessibility'),
      text('Barriers to support'),
      text('Changes that would help'),
    ],
    {
      category: 'Wellbeing',
      tags: ['wellbeing', 'mental health', 'support'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Wellbeing & Retention Pack',
      rolloutSuggestion:
        'Run quarterly; always share where to find support resources at the end of the survey.',
    },
  ),
  survey(
    'Exit Experience',
    "Collect feedback about an employee's experience when leaving.",
    [
      scale('Overall experience', RATING),
      choice('Reasons for leaving', [
        'Career growth',
        'Compensation',
        'Manager relationship',
        'Workload',
        'Relocation or personal',
        'Other',
      ]),
      text('What worked well'),
      text('What could improve'),
    ],
    {
      category: 'Offboarding',
      tags: ['exit', 'offboarding', 'retention'],
      audience: 'Departing employees',
      estimatedDurationMinutes: 8,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Send during the final two weeks of employment; review themes quarterly to improve retention.',
    },
  ),
  survey(
    'Post-training Feedback',
    'Evaluate the relevance and usefulness of completed training.',
    [
      scale('Content relevance'),
      scale('Trainer effectiveness', RATING),
      scale('Confidence applying learning'),
      text('Future learning needs'),
    ],
    {
      category: 'Growth & Development',
      tags: ['training', 'learning', 'evaluation'],
      audience: 'Training participants',
      estimatedDurationMinutes: 4,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Send within 48 hours of a training session while the experience is fresh.',
    },
  ),

  // 1:1 conversations
  oneOnOne(
    'Manager 1:1 Check-in',
    'Support an open, constructive recurring manager check-in.',
    [
      'Recent wins',
      'Current priorities',
      'Blockers and support',
      'Wellbeing and growth',
    ],
    {
      category: 'Management',
      tags: ['1:1', 'check-in', 'manager'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 30,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Use as the default weekly or bi-weekly 1:1 for every manager and direct report.',
    },
  ),
  oneOnOne(
    'New Hire 30-Day Check-in',
    "Review a new hire's first month and identify support needs.",
    [
      'First-month experience',
      'Role and expectations',
      'Tools and relationships',
      'Questions and support',
    ],
    {
      category: 'Onboarding',
      tags: ['onboarding', 'new hire', '30-day'],
      audience: 'New hires and their managers',
      estimatedDurationMinutes: 30,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Schedule automatically at day 30 for every new hire, alongside the Onboarding Experience survey.',
    },
  ),
  oneOnOne(
    '90-Day Growth Review',
    'Review progress, learning, and priorities after the first 90 days.',
    [
      'Progress and achievements',
      'Learning so far',
      'Challenges',
      'Next-quarter goals',
    ],
    {
      category: 'Onboarding',
      tags: ['onboarding', '90-day', 'growth'],
      audience: 'New hires and their managers',
      estimatedDurationMinutes: 45,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Schedule at day 90 as the follow-up to the 30-day check-in.',
    },
  ),
  oneOnOne(
    'Career Development 1:1',
    'Discuss career interests and actionable development steps.',
    [
      'Career interests',
      'Strengths and skills',
      'Growth opportunities',
      'Action plan',
    ],
    {
      category: 'Growth & Development',
      tags: ['1:1', 'career', 'development'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 45,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Hold twice a year with every direct report, separate from performance reviews.',
    },
  ),
  oneOnOne(
    'Performance Support Conversation',
    'Discuss performance concerns constructively and agree on support.',
    [
      'Employee perspective',
      'Expectations and examples',
      'Barriers and support',
      'Agreed next steps',
    ],
    {
      category: 'Performance',
      tags: ['1:1', 'performance', 'coaching'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 45,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Use as soon as a performance concern appears; follow up within two weeks.',
    },
  ),
  oneOnOne(
    'Recognition 1:1',
    'Recognize contributions and discuss what enables continued success.',
    [
      'Recent contributions',
      'Impact and strengths',
      'Recognition preferences',
      'Future opportunities',
    ],
    {
      category: 'Culture',
      tags: ['1:1', 'recognition'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 20,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Use after a project milestone or standout contribution.',
    },
  ),
  oneOnOne(
    'Workload Prioritization 1:1',
    'Align on workload, priorities, and realistic commitments.',
    [
      'Current workload',
      'Priority ranking',
      'Conflicts and trade-offs',
      'Decisions and owners',
    ],
    {
      category: 'Wellbeing',
      tags: ['1:1', 'workload', 'prioritization'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 30,
      pack: 'Wellbeing & Retention Pack',
      rolloutSuggestion:
        'Use when the Workload & Burnout Check flags risk, or at the start of a busy period.',
    },
  ),
  oneOnOne(
    'Conflict Resolution 1:1',
    'Facilitate a respectful discussion of conflict and possible resolution.',
    [
      'Each perspective',
      'Shared facts and impact',
      'Possible solutions',
      'Agreements and follow-up',
    ],
    {
      category: 'Team Effectiveness',
      tags: ['1:1', 'conflict', 'mediation'],
      audience: 'Managers, HR, and involved colleagues',
      estimatedDurationMinutes: 45,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Use with a trained facilitator; schedule a follow-up check-in two weeks later.',
    },
  ),
  oneOnOne(
    'Return-from-Leave Check-in',
    'Support a thoughtful return to work and clarify immediate needs.',
    [
      'Return-to-work experience',
      'Current priorities',
      'Adjustments or support',
      'Follow-up plan',
    ],
    {
      category: 'Wellbeing',
      tags: ['1:1', 'return to work', 'leave'],
      audience: 'Employees returning from leave',
      estimatedDurationMinutes: 30,
      pack: 'Wellbeing & Retention Pack',
      rolloutSuggestion:
        'Schedule in the first week back, with a second check-in after one month.',
    },
  ),
  oneOnOne(
    'Skip-level Listening Session',
    'Hear employee perspectives and identify themes for organizational improvement.',
    [
      'Team experience',
      'What is working',
      'Challenges and concerns',
      'Suggestions',
    ],
    {
      category: 'Management',
      tags: ['1:1', 'skip-level', 'listening'],
      audience: 'Senior leaders and employees two levels down',
      estimatedDurationMinutes: 30,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Rotate quarterly through each team; share aggregated themes, never individual comments.',
    },
  ),
  oneOnOne(
    'Team Lead Weekly Review',
    'Review team progress, risks, and leadership support needs.',
    [
      'Weekly progress',
      'Upcoming priorities',
      'Risks and blockers',
      'Decisions and support',
    ],
    {
      category: 'Management',
      tags: ['1:1', 'weekly', 'team lead'],
      audience: 'Team leads and their managers',
      estimatedDurationMinutes: 30,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion: 'Use as a recurring weekly sync for team leads.',
    },
  ),
  oneOnOne(
    'Project Retrospective',
    'Reflect on a project and identify practical lessons for future work.',
    [
      'What went well',
      'What did not go well',
      'Root causes and lessons',
      'Actions for next time',
    ],
    {
      category: 'Team Effectiveness',
      tags: ['retrospective', 'project', 'lessons learned'],
      audience: 'Project team members',
      estimatedDurationMinutes: 45,
      pack: CORE_PACK,
      rolloutSuggestion:
        'Run within two weeks of every project or milestone close-out.',
    },
  ),
  oneOnOne(
    'Goal-setting 1:1',
    'Agree on clear goals, success measures, and next steps.',
    [
      'Desired outcomes',
      'Success measures',
      'Dependencies and risks',
      'Actions and milestones',
    ],
    {
      category: 'Performance',
      tags: ['1:1', 'goals', 'okr'],
      audience: 'Managers and direct reports',
      estimatedDurationMinutes: 45,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Use at the start of each quarter or performance cycle.',
    },
  ),
  oneOnOne(
    'Promotion Readiness Conversation',
    'Discuss role expectations, evidence of readiness, and development gaps.',
    [
      'Target role expectations',
      'Evidence of impact',
      'Skills to develop',
      'Milestones and support',
    ],
    {
      category: 'Growth & Development',
      tags: ['1:1', 'promotion', 'career'],
      audience: 'Managers and promotion candidates',
      estimatedDurationMinutes: 45,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Hold 3–6 months before a promotion cycle to leave time to close gaps.',
    },
  ),
  oneOnOne(
    'Difficult Feedback Preparation',
    'Prepare a fair, specific, and constructive feedback conversation.',
    [
      'Purpose and desired outcome',
      'Specific observations',
      'Impact and employee perspective',
      'Support and follow-up',
    ],
    {
      category: 'Management',
      tags: ['feedback', 'preparation', 'coaching'],
      audience: 'Managers (with HR or a coach)',
      estimatedDurationMinutes: 30,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Use before any sensitive feedback conversation; pair with the Performance Support Conversation.',
    },
  ),
  oneOnOne(
    'Retention Listening Conversation',
    'Understand what helps an employee stay and what might prompt them to leave.',
    [
      'What is working',
      'Motivators and concerns',
      'Growth and support',
      'Possible improvements',
    ],
    {
      category: 'Retention',
      tags: ['1:1', 'stay interview', 'retention'],
      audience: 'Managers and key employees',
      estimatedDurationMinutes: 30,
      pack: 'Wellbeing & Retention Pack',
      rolloutSuggestion:
        'Hold annually with each employee, and sooner with high-flight-risk roles.',
    },
  ),
  oneOnOne(
    'First-time Manager Support',
    'Help a new manager navigate challenges and build management skills.',
    [
      'Recent management challenges',
      'Team communication',
      'Confidence and skill gaps',
      'Coaching and next steps',
    ],
    {
      category: 'Management',
      tags: ['1:1', 'new manager', 'coaching'],
      audience: 'First-time managers and their mentors',
      estimatedDurationMinutes: 45,
      pack: 'Growth & Learning Pack',
      rolloutSuggestion:
        'Run monthly for the first six months after someone becomes a manager.',
    },
  ),
  oneOnOne(
    'Creative Brainstorm Session',
    'Generate ideas collaboratively and identify promising next experiments.',
    [
      'Problem to solve',
      'Ideas without judgment',
      'Explore and combine ideas',
      'Experiments and owners',
    ],
    {
      category: 'Innovation',
      tags: ['brainstorm', 'ideas', 'innovation'],
      audience: 'Teams and project groups',
      estimatedDurationMinutes: 45,
      pack: 'Innovation & AI Pack',
      rolloutSuggestion:
        'Use at the start of a new initiative or when a team is stuck on a problem.',
    },
  ),
  oneOnOne(
    'Decision Alignment 1:1',
    'Clarify a decision, evaluate options, and align on next steps.',
    [
      'Decision to make',
      'Options and evidence',
      'Trade-offs and concerns',
      'Decision and ownership',
    ],
    {
      category: 'Team Effectiveness',
      tags: ['decision-making', 'alignment'],
      audience: 'Decision owners and stakeholders',
      estimatedDurationMinutes: 30,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Use for any decision with multiple stakeholders or significant trade-offs.',
    },
  ),
  oneOnOne(
    'Blocker Removal Session',
    'Identify obstacles and agree on actions to unblock progress.',
    [
      'Desired outcome',
      'Current blockers',
      'Dependencies and decisions',
      'Owners and deadlines',
    ],
    {
      category: 'Team Effectiveness',
      tags: ['blockers', 'execution'],
      audience: 'Team members and leads',
      estimatedDurationMinutes: 20,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Use ad hoc whenever work stalls for more than a few days.',
    },
  ),
  oneOnOne(
    'Customer Escalation Debrief',
    'Review a customer escalation and identify resolution and prevention actions.',
    [
      'Customer impact',
      'Timeline and contributing factors',
      'Resolution and communication',
      'Prevention actions',
    ],
    {
      category: 'Operations',
      tags: ['customer', 'escalation', 'post-mortem'],
      audience: 'Customer-facing and support teams',
      estimatedDurationMinutes: 45,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Run within a week of resolving any major customer escalation.',
    },
  ),
  oneOnOne(
    'Stakeholder Alignment 1:1',
    'Align stakeholders on expectations, responsibilities, and dependencies.',
    [
      'Shared objective',
      'Stakeholder expectations',
      'Dependencies and risks',
      'Owners and next steps',
    ],
    {
      category: 'Team Effectiveness',
      tags: ['stakeholders', 'alignment'],
      audience: 'Project leads and stakeholders',
      estimatedDurationMinutes: 30,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Use at project kickoff and again at major milestones.',
    },
  ),
  oneOnOne(
    'Innovation Check-in',
    'Explore new ideas, experiments, and barriers to innovation.',
    [
      'New ideas',
      'Customer or team problem',
      'Risks and assumptions',
      'Small experiments',
    ],
    {
      category: 'Innovation',
      tags: ['1:1', 'innovation', 'experiments'],
      audience: 'Managers and team members',
      estimatedDurationMinutes: 30,
      pack: 'Innovation & AI Pack',
      rolloutSuggestion:
        'Hold monthly with teams that have dedicated innovation or improvement time.',
    },
  ),

  // More surveys
  survey(
    'Quarterly Team Health Review',
    'Review team health, collaboration, workload, and priorities each quarter.',
    [
      scale('Team morale', MOOD),
      scale('Workload sustainability'),
      scale('Collaboration and trust'),
      text('Priority improvements'),
    ],
    {
      category: 'Team Effectiveness',
      tags: ['team health', 'quarterly'],
      audience: 'Team members',
      estimatedDurationMinutes: 6,
      pack: 'Team Effectiveness Pack',
      rolloutSuggestion:
        'Run at the end of each quarter and discuss results in the team retrospective.',
    },
  ),
  survey(
    'Leadership Communication Feedback',
    'Assess how clearly and effectively leaders communicate.',
    [
      scale('Clarity of leadership messages'),
      scale('Timeliness and transparency'),
      yesNo('Opportunity to ask questions'),
      text('Improvements needed'),
    ],
    {
      category: 'Communication',
      tags: ['leadership', 'communication', 'transparency'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Send after all-hands meetings or major leadership announcements.',
    },
  ),
  survey(
    'Process Friction Audit',
    'Identify inefficient processes and recurring operational friction.',
    [
      text('Most frustrating processes'),
      choice('Sources of delay', [
        'Approvals',
        'Unclear ownership',
        'Tooling',
        'Waiting on other teams',
        'Manual work',
      ]),
      text('Tools or handoffs'),
      text('Suggested fixes'),
    ],
    {
      category: 'Operations',
      tags: ['process', 'efficiency', 'operations'],
      audience: 'All employees',
      estimatedDurationMinutes: 8,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Run annually or before an operations improvement initiative; publish the top fixes.',
    },
  ),
  survey(
    'AI Tool Adoption Pulse',
    'Understand AI tool adoption, confidence, and support needs.',
    [
      choice('Current usage', [
        'Daily',
        'Weekly',
        'Monthly',
        'Rarely',
        'Never',
      ]),
      scale('Confidence and usefulness'),
      text('Concerns and barriers'),
      text('Training or support needed'),
    ],
    {
      category: 'Innovation',
      tags: ['ai', 'adoption', 'tools'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Innovation & AI Pack',
      rolloutSuggestion:
        'Run 30 and 90 days after rolling out a new AI tool to track adoption.',
    },
  ),
  survey(
    'Ethics & Speak-up Climate',
    'Understand awareness of ethical expectations and comfort raising concerns.',
    [
      scale('Clarity of expectations'),
      scale('Comfort raising concerns'),
      scale('Confidence concerns are addressed'),
      text('Improvements needed'),
    ],
    {
      category: 'Culture',
      tags: ['ethics', 'speak up', 'compliance'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Culture & Inclusion Pack',
      rolloutSuggestion:
        'Run annually alongside compliance training; always keep responses anonymous.',
    },
  ),
  survey(
    'Internal Tools Satisfaction',
    'Evaluate satisfaction with internal tools and identify usability gaps.',
    [
      scale('Ease of use', RATING),
      scale('Reliability and performance', RATING),
      scale('Impact on productivity'),
      text('Requested improvements'),
    ],
    {
      category: 'Operations',
      tags: ['tools', 'it', 'productivity'],
      audience: 'All employees',
      estimatedDurationMinutes: 5,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Run semi-annually or after a major tooling change; share results with IT.',
    },
  ),
  survey(
    'Quarterly Priorities Alignment',
    'Assess how clearly employees understand and align with quarterly priorities.',
    [
      scale('Priority clarity'),
      scale('Understanding of team contribution'),
      yesNo('Conflicting priorities'),
      text('Alignment improvements'),
    ],
    {
      category: 'Strategy',
      tags: ['priorities', 'alignment', 'quarterly'],
      audience: 'All employees',
      estimatedDurationMinutes: 4,
      pack: 'Operations & Change Pack',
      rolloutSuggestion:
        'Send two to three weeks into each quarter, after priorities are communicated.',
    },
  ),
];
