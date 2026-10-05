"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIZARD_STEPS = void 0;
exports.sessionFilterToQuery = sessionFilterToQuery;
exports.nextWizardStep = nextWizardStep;
exports.wizardStepPath = wizardStepPath;
exports.sessionJoinPath = sessionJoinPath;
exports.WIZARD_STEPS = [
    {
        id: 'choose_type',
        number: 1,
        title: 'Choose Session Type',
        blurb: 'Select the type of session that best fits your needs.',
    },
    {
        id: 'describe',
        number: 2,
        title: 'Describe Session',
        blurb: 'Goals, tone, and AI prompt builder.',
    },
    {
        id: 'verify',
        number: 3,
        title: 'Verify & Customize',
        blurb: 'Review topics, settings, and draft.',
    },
    {
        id: 'participants',
        number: 4,
        title: 'Select Participants',
        blurb: 'Add from contacts, groups, or CSV.',
    },
    {
        id: 'reports',
        number: 5,
        title: 'Build Reports',
        blurb: 'Choose or create a report template.',
    },
    {
        id: 'schedule',
        number: 6,
        title: 'Schedule & Launch',
        blurb: 'Set timing and go live.',
    },
];
function sessionFilterToQuery(filter) {
    switch (filter) {
        case 'ongoing':
            return { status: 'ongoing' };
        case 'scheduled':
            return { status: 'scheduled' };
        case 'drafts':
            return { status: 'draft' };
        case 'completed':
            return { status: 'completed' };
        case 'archived':
            return { status: 'archived' };
        case 'favorites':
            return { favorite: true };
        default:
            return {};
    }
}
function nextWizardStep(current) {
    const idx = exports.WIZARD_STEPS.findIndex((s) => s.id === current);
    if (idx < 0 || idx >= exports.WIZARD_STEPS.length - 1)
        return null;
    return exports.WIZARD_STEPS[idx + 1].id;
}
function wizardStepPath(sessionId, step) {
    return `/sessions/create/${sessionId}/${step}`;
}
function sessionJoinPath(session) {
    if (session.type === 'survey')
        return `/survey/join/${session.id}`;
    return `/one-on-one/join/${session.id}`;
}
//# sourceMappingURL=index.js.map