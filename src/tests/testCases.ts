// Test case definitions for AI pipeline testing
// ~38 test cases covering every scenario category

export interface TestCaseEmail {
  sender: string;
  subject: string;
  body_text: string;
  has_attachments: boolean;
}

export interface ExpectedClassification {
  category: string; // 'Urgent' | 'Important' | 'Normal' | 'Low'
  acceptable_categories?: string[];
  requires_reply: boolean;
}

export interface LifeDataFieldExpectation {
  data_type: string;
  amount?: number;
  currency?: string;
  frequency?: string;
  carrier?: string;
  tracking_number?: string;
  confirmation_number?: string;
  dates?: string[];
}

export interface ExpectedAnalysis {
  requires_reply: boolean;
  deadline_expected: boolean;
  deadline_date_approx?: string;
  meeting_expected: boolean;
  event_type?: string; // 'meeting' | 'event' | 'webinar' | 'workshop'
  expected_life_data_types?: string[];
  acceptable_tones?: string[];
  expected_attachment_keywords?: string[];
  missing_attachment_expected?: boolean;
  min_questions?: number;
  max_questions?: number;
  // New assertion dimensions
  expected_deadline_display?: string;     // e.g., "Due in 7 days", "Due today"
  expected_event_type?: string;           // 'meeting' | 'event' — redundant with event_type but explicit
  expected_formality_range?: [number, number]; // e.g., [60, 100] for formal
  expected_life_data_fields?: LifeDataFieldExpectation[]; // verify amounts, dates, etc.
  deadline_must_coexist_with_category?: boolean; // if true, deadline + category must BOTH be set
  expected_crm_category?: string;         // 'Colleague' | 'Client' | 'Vendor' | etc.
  requires_reply_reasoning_keywords?: string[]; // keywords that should appear in reply_reasoning
}

export interface TestCase {
  id: string;
  name: string;
  scenario_category: string;
  email: TestCaseEmail;
  expected_classification: ExpectedClassification;
  expected_analysis: ExpectedAnalysis;
}

// Helper: generates a date string N days from now
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

const nextFriday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().split('T')[0];
})();

export const TEST_CASES: TestCase[] = [
  // ===== A: MEETING REQUESTS (4) =====
  {
    id: 'A1',
    name: '1-on-1 meeting request',
    scenario_category: 'meeting',
    email: {
      sender: 'sarah.chen@company.com',
      subject: 'Quick sync this week?',
      body_text: `Hey,

Can we grab 30 minutes this Thursday or Friday to go over the Q2 roadmap? I'd like to align on the feature priorities before the sprint planning next Monday.

Let me know what works for you.

Thanks,
Sarah`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['friendly', 'casual', 'neutral', 'professional'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'A2',
    name: 'Group meeting invite',
    scenario_category: 'meeting',
    email: {
      sender: 'mike.johnson@company.com',
      subject: 'Team retrospective - Wednesday 2pm',
      body_text: `Hi team,

I'd like to schedule our sprint retrospective for this Wednesday at 2:00 PM EST. The meeting should take about an hour.

Agenda:
1. What went well
2. What could be improved
3. Action items for next sprint

Please confirm your attendance by EOD today.

Best,
Mike`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true, // "confirm by EOD today" is a deadline
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['professional', 'neutral', 'friendly'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'A3',
    name: 'Meeting reschedule',
    scenario_category: 'meeting',
    email: {
      sender: 'lisa.park@client.com',
      subject: 'Re: Project kickoff - need to reschedule',
      body_text: `Hi,

Unfortunately something came up and I need to move our Thursday 10am meeting. Would either Friday at 11am or Monday at 2pm work instead?

Apologies for the inconvenience.

Best,
Lisa`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['apologetic', 'professional', 'friendly'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'A4',
    name: 'Zoom invite with link',
    scenario_category: 'meeting',
    email: {
      sender: 'recruiter@techcorp.com',
      subject: 'Interview scheduled - Senior Engineer Role',
      body_text: `Hello,

Your technical interview has been scheduled for ${nextFriday} at 3:00 PM PST.

Zoom Link: https://zoom.us/j/1234567890
Duration: 60 minutes
Interviewers: James Wright (Engineering Manager), Priya Patel (Staff Engineer)

Please confirm your attendance and let us know if you have any questions.

Best regards,
TechCorp Recruiting`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['professional', 'formal', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },

  // ===== B: EVENTS (3) =====
  {
    id: 'B1',
    name: 'Tech talk announcement',
    scenario_category: 'event',
    email: {
      sender: 'events@techcommunity.org',
      subject: 'Upcoming: AI in Production - Tech Talk Series',
      body_text: `You're invited to our next tech talk!

Topic: AI in Production - Lessons from Scaling LLMs
Speaker: Dr. Alex Morgan, VP of Engineering at ScaleAI
Date: ${daysFromNow(14)} at 6:30 PM
Location: TechHub Downtown, Room 301

This is a free event, but space is limited. No RSVP required.

See you there!
TechCommunity Events Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true, // Tech talks are events → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['friendly', 'casual', 'enthusiastic', 'neutral'],
    },
  },
  {
    id: 'B2',
    name: 'Workshop with RSVP deadline',
    scenario_category: 'event',
    email: {
      sender: 'training@company.com',
      subject: 'Leadership Workshop - RSVP by ' + daysFromNow(5),
      body_text: `Dear team member,

We're hosting a full-day Leadership Workshop on ${daysFromNow(12)}.

Details:
- Time: 9:00 AM - 4:30 PM
- Location: Conference Center, Building B
- Lunch provided

Spots are limited to 25 participants. Please RSVP by ${daysFromNow(5)} to secure your spot.

Register here: [internal link]

HR Training Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: true, // Workshops are events → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['professional', 'neutral', 'formal', 'friendly'],
    },
  },
  {
    id: 'B3',
    name: 'Conference early bird',
    scenario_category: 'event',
    email: {
      sender: 'info@devconf2025.com',
      subject: 'DevConf 2025 - Early Bird Tickets Now Available',
      body_text: `DevConf 2025 is coming!

Join 5,000+ developers on ${daysFromNow(60)} - ${daysFromNow(62)} in San Francisco.

Early bird pricing: $299 (regular $499)
Early bird deadline: ${daysFromNow(20)}

Keynote speakers include leaders from Google, Meta, and Anthropic.

Get your ticket: devconf2025.com/tickets

Don't miss out!`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(20),
      meeting_expected: true, // Conference is an event → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['enthusiastic', 'excited', 'promotional', 'friendly', 'casual', 'neutral'],
    },
  },

  // ===== C: DEADLINES (5) =====
  {
    id: 'C1',
    name: 'Application deadline',
    scenario_category: 'deadline',
    email: {
      sender: 'admissions@gradschool.edu',
      subject: 'Application deadline reminder',
      body_text: `Dear Applicant,

This is a reminder that the deadline for your graduate school application is ${daysFromNow(7)}.

Please ensure the following are submitted:
- Personal statement
- Two letters of recommendation
- Official transcripts
- GRE scores

Incomplete applications will not be reviewed.

Office of Admissions`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(7),
      meeting_expected: false,
      acceptable_tones: ['formal', 'professional', 'neutral'],
    },
  },
  {
    id: 'C2',
    name: 'RSVP-by deadline',
    scenario_category: 'deadline',
    email: {
      sender: 'friend@gmail.com',
      subject: 'Wedding RSVP - please respond!',
      body_text: `Hey!

Just a reminder that we need your RSVP for the wedding by ${daysFromNow(10)}. We're finalizing the seating chart and catering numbers.

Please let us know:
1. Will you attend?
2. Plus one?
3. Any dietary restrictions?

Can't wait to celebrate with you!

Love,
Jamie & Alex`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(10),
      meeting_expected: true, // Wedding is an event to attend → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['friendly', 'excited', 'casual', 'warm'],
      min_questions: 1,
      max_questions: 4,
    },
  },
  {
    id: 'C3',
    name: 'Payment due date',
    scenario_category: 'deadline',
    email: {
      sender: 'billing@utilities.com',
      subject: 'Your electricity bill is due',
      body_text: `Account #: 12345678

Your electricity bill for January is ready.

Amount due: $142.87
Due date: ${daysFromNow(14)}

Pay online at utilities.com/pay or call 1-800-555-0123.

Thank you,
City Electric Company`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14),
      meeting_expected: false,
      expected_life_data_types: ['bill'],
      acceptable_tones: ['neutral', 'professional', 'formal'],
    },
  },
  {
    id: 'C4',
    name: 'Respond-by deadline from boss',
    scenario_category: 'deadline',
    email: {
      sender: 'manager@company.com',
      subject: 'Need your input on budget proposal',
      body_text: `Hi,

I need your input on the Q2 budget proposal. Specifically:
- Projected headcount for your team
- Tool/infrastructure costs
- Any planned vendor contracts

Please send this over by end of day ${daysFromNow(3)}. Finance needs the consolidated numbers by Friday.

Thanks,
David`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(3),
      meeting_expected: false,
      acceptable_tones: ['professional', 'neutral', 'direct', 'straightforward'],
      min_questions: 1,
      max_questions: 4,
    },
  },
  {
    id: 'C5',
    name: 'Registration closing soon',
    scenario_category: 'deadline',
    email: {
      sender: 'marathon@cityrun.org',
      subject: 'Last chance: Marathon registration closes ' + daysFromNow(4),
      body_text: `Hi Runner,

Registration for the City Marathon closes on ${daysFromNow(4)}!

Race date: ${daysFromNow(45)}
Registration fee: $75
Includes: race bib, timing chip, finisher medal, t-shirt

Register now at cityrun.org/register

Only 200 spots remaining!

City Marathon Committee`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(4),
      meeting_expected: true, // Marathon is an event to attend → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['enthusiastic', 'urgent', 'promotional', 'friendly', 'casual', 'neutral'],
    },
  },

  // ===== D: NON-DEADLINE DATES (3) =====
  {
    id: 'D1',
    name: 'Event date (not a deadline)',
    scenario_category: 'non-deadline-date',
    email: {
      sender: 'coordinator@community.org',
      subject: 'Community BBQ this Saturday!',
      body_text: `Hey neighbors!

Our annual community BBQ is happening this Saturday (${daysFromNow(3)}) from 12-4 PM at Riverside Park.

Bring your family and a dish to share! We'll have games, music, and a bounce house for the kids.

Hope to see you there!
Community Events Committee`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true, // BBQ is an event to attend → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['friendly', 'enthusiastic', 'casual', 'warm', 'excited'],
    },
  },
  {
    id: 'D2',
    name: 'Sale ending date',
    scenario_category: 'non-deadline-date',
    email: {
      sender: 'deals@techstore.com',
      subject: '40% OFF ends Sunday!',
      body_text: `FLASH SALE

40% off all laptops and tablets! Sale ends ${daysFromNow(4)}.

Top picks:
- MacBook Pro 14" - $1,499 (was $2,499)
- iPad Air - $359 (was $599)
- Dell XPS 15 - $899 (was $1,499)

Shop now: techstore.com/sale

Free shipping on orders over $100.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['promotional', 'enthusiastic', 'excited', 'urgent', 'casual', 'neutral'],
    },
  },
  {
    id: 'D3',
    name: 'FYI date in newsletter',
    scenario_category: 'non-deadline-date',
    email: {
      sender: 'newsletter@techweekly.com',
      subject: 'This Week in Tech - AI breakthroughs & more',
      body_text: `TECH WEEKLY DIGEST

Top Stories:
1. OpenAI announces GPT-5 release on ${daysFromNow(30)}
2. Apple's WWDC keynote ${daysFromNow(45)}: What to expect
3. New EU AI Act takes effect ${daysFromNow(60)}

Opinion: Why on-device AI is the future
Interview: CTO of Stripe on payments innovation

Read more at techweekly.com`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'informative', 'casual'],
    },
  },

  // ===== E: NEWSLETTERS / MARKETING (3) =====
  {
    id: 'E1',
    name: 'Tech digest newsletter',
    scenario_category: 'newsletter',
    email: {
      sender: 'digest@hackernews.com',
      subject: 'HN Daily: Top 10 Stories',
      body_text: `Hacker News Daily Digest

1. Show HN: I built a real-time collaborative code editor (423 points)
2. Why we switched from Kubernetes to bare metal (387 points)
3. The hidden costs of microservices (312 points)
4. SQLite is all you need (289 points)
5. A visual guide to SSH tunneling (267 points)

Read all stories: hackernews.com/daily

You received this because you subscribed. Unsubscribe: hackernews.com/unsub`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'informative', 'casual', 'professional'],
    },
  },
  {
    id: 'E2',
    name: 'Promotional email',
    scenario_category: 'newsletter',
    email: {
      sender: 'marketing@saasproduct.com',
      subject: 'Unlock Premium Features - 50% off for you!',
      body_text: `Hi there,

We noticed you've been using our free tier for 3 months. You're clearly getting value from the platform!

For a limited time, upgrade to Premium at 50% off:
- Unlimited projects
- Priority support
- Advanced analytics
- Team collaboration

Use code UPGRADE50 at checkout.

Offer expires in 7 days.

The SaaSProduct Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['promotional', 'friendly', 'enthusiastic', 'casual', 'neutral'],
    },
  },
  {
    id: 'E3',
    name: 'Substack post',
    scenario_category: 'newsletter',
    email: {
      sender: 'writer@substack.com',
      subject: 'The Art of Deep Work in a Distracted World',
      body_text: `New post from Thoughtful Engineer

The Art of Deep Work in a Distracted World

I've been experimenting with time-blocking for the past 6 months. Here's what I learned:

1. The first hour matters most
2. Context switching costs more than you think
3. "Creative mode" vs "admin mode" scheduling
4. Why I deleted Slack from my phone

Read the full post: substack.com/p/deep-work

Like this post? Share it with a friend.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['casual', 'friendly', 'informative', 'neutral', 'conversational'],
    },
  },

  // ===== F: AUTOMATED NOTIFICATIONS (4) =====
  {
    id: 'F1',
    name: 'GitHub PR notification',
    scenario_category: 'automated',
    email: {
      sender: 'notifications@github.com',
      subject: '[myorg/myrepo] PR #234: Fix memory leak in cache layer',
      body_text: `@teammate requested your review on PR #234

Fix memory leak in cache layer

Changes:
- Fixed WeakRef usage in LRU cache
- Added cleanup interval for expired entries
- Updated tests

Files changed: 3
+47 -12

View: github.com/myorg/myrepo/pull/234`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'technical'],
    },
  },
  {
    id: 'F2',
    name: 'Jira ticket assigned',
    scenario_category: 'automated',
    email: {
      sender: 'jira@company.atlassian.net',
      subject: '[PROJ-1234] Bug: Login page crashes on Safari',
      body_text: `PROJ-1234 has been assigned to you.

Type: Bug
Priority: High
Reporter: QA Team
Sprint: Sprint 15

Description:
Users on Safari 17.x are experiencing crashes on the login page when clicking "Sign in with Google". Stack trace points to an uncaught promise rejection in the OAuth flow.

Steps to reproduce:
1. Open Safari 17.x
2. Navigate to login page
3. Click "Sign in with Google"
4. Observe crash

Expected: OAuth flow completes
Actual: Page crashes

View issue: company.atlassian.net/browse/PROJ-1234`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'technical'],
    },
  },
  {
    id: 'F3',
    name: 'LinkedIn connection request',
    scenario_category: 'automated',
    email: {
      sender: 'messages-noreply@linkedin.com',
      subject: 'John Smith wants to connect with you',
      body_text: `John Smith, Engineering Manager at BigTech Inc., wants to connect.

"Hi! I came across your profile and was impressed by your work on open-source projects. Would love to connect."

Accept: linkedin.com/accept/12345
Ignore: linkedin.com/ignore/12345

You have 342 connections.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'friendly'],
    },
  },
  {
    id: 'F4',
    name: 'Slack digest',
    scenario_category: 'automated',
    email: {
      sender: 'notification@slack.com',
      subject: 'Activity in #engineering you may have missed',
      body_text: `Here's what you missed in Slack:

#engineering (12 new messages)
- @alice: Deployed v2.4.1 to staging
- @bob: Anyone seeing flaky tests in CI?
- @carol: New RFC for database migration posted

#general (5 new messages)
- @hr: Office closed for President's Day
- @ceo: Q4 all-hands recording posted

Open Slack: slack.com/open`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'informative', 'casual'],
    },
  },

  // ===== G: FINANCIAL / LIFE INTEL (4) =====
  {
    id: 'G1',
    name: 'Invoice / bill',
    scenario_category: 'financial',
    email: {
      sender: 'billing@cloudprovider.com',
      subject: 'Your January invoice - $287.43',
      body_text: `Invoice #INV-2025-01-4567

Account: Professional Plan
Period: January 1 - January 31, 2025

Compute: $198.50
Storage: $45.93
Bandwidth: $32.00
Tax: $11.00
Total: $287.43

Payment will be charged to your card ending in 4242 on ${daysFromNow(7)}.

View invoice: cloudprovider.com/billing/inv-4567`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(7),
      meeting_expected: false,
      expected_life_data_types: ['bill'],
      acceptable_tones: ['neutral', 'professional', 'formal'],
    },
  },
  {
    id: 'G2',
    name: 'Subscription renewal notice',
    scenario_category: 'financial',
    email: {
      sender: 'noreply@streamingservice.com',
      subject: 'Your subscription renews in 5 days',
      body_text: `Hi,

Your Premium subscription will automatically renew on ${daysFromNow(5)}.

Plan: Premium Family
Price: $22.99/month
Payment: Visa ending in 8901

If you'd like to make changes to your subscription, visit your account settings before the renewal date.

StreamingService Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: false,
      expected_life_data_types: ['subscription'],
      acceptable_tones: ['neutral', 'professional', 'informative'],
    },
  },
  {
    id: 'G3',
    name: 'Package delivery notification',
    scenario_category: 'financial',
    email: {
      sender: 'shipping@amazon.com',
      subject: 'Your package is out for delivery',
      body_text: `Your order is on its way!

Order #112-3456789-0123456
Item: Sony WH-1000XM5 Wireless Headphones
Estimated delivery: Today by 8 PM

Tracking number: 1Z9999999999999999
Carrier: UPS

Track your package: amazon.com/track/12345

Delivery instructions: Leave at front door`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['package'],
      acceptable_tones: ['neutral', 'informative', 'friendly'],
    },
  },
  {
    id: 'G4',
    name: 'Travel confirmation',
    scenario_category: 'financial',
    email: {
      sender: 'confirmations@airline.com',
      subject: 'Booking Confirmed: SFO → NYC',
      body_text: `Booking Confirmation

Confirmation #: ABC123
Passenger: John Doe

Flight 1: UA 234
Date: ${daysFromNow(21)}
Depart: SFO 8:00 AM → Arrive: JFK 4:30 PM

Flight 2: UA 567
Date: ${daysFromNow(25)}
Depart: JFK 6:00 PM → Arrive: SFO 9:15 PM

Total: $458.00

Manage booking: airline.com/manage/ABC123`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['travel'],
      acceptable_tones: ['neutral', 'professional', 'formal', 'informative'],
    },
  },

  // ===== H: DIRECT QUESTIONS (3) =====
  {
    id: 'H1',
    name: 'Colleague asking a question',
    scenario_category: 'question',
    email: {
      sender: 'colleague@company.com',
      subject: 'Quick question about the API migration',
      body_text: `Hey,

I'm working on migrating the user service to the new API v3 endpoints. A couple questions:

1. Should I use the new auth middleware or keep the legacy one for now?
2. Is there a migration guide somewhere? I couldn't find one in Confluence.
3. Who should review the PR — you or the platform team?

No rush, just want to make sure I'm not going down the wrong path.

Thanks!
Chris`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'casual', 'neutral'],
      min_questions: 2,
      max_questions: 5,
    },
  },
  {
    id: 'H2',
    name: 'Boss asking for deliverable',
    scenario_category: 'question',
    email: {
      sender: 'vp@company.com',
      subject: 'Status update on Project Phoenix',
      body_text: `Hi,

The board meeting is on ${daysFromNow(5)} and I need to present our progress on Project Phoenix.

Can you put together a brief status update covering:
- Current milestone completion %
- Any blockers or risks
- Updated timeline

I'll need this by EOD ${daysFromNow(2)}.

Thanks,
Jennifer`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(2),
      meeting_expected: false,
      acceptable_tones: ['professional', 'direct', 'neutral', 'straightforward'],
      min_questions: 1,
      max_questions: 4,
    },
  },
  {
    id: 'H3',
    name: 'External contact follow-up',
    scenario_category: 'question',
    email: {
      sender: 'partner@vendor.com',
      subject: 'Re: Integration proposal',
      body_text: `Hi,

Thanks for the meeting last week. Following up on the integration proposal:

1. Have you had a chance to review the API docs I sent?
2. What's your preferred timeline for the pilot?
3. Should we set up a sandbox environment for your team?

Also, our engineering lead would like to schedule a technical deep-dive. Would next week work?

Looking forward to hearing from you.

Best,
Rachel`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      acceptable_tones: ['professional', 'friendly', 'neutral'],
      min_questions: 2,
      max_questions: 5,
    },
  },

  // ===== I: CC'D EMAILS (2) =====
  {
    id: 'I1',
    name: "CC'd on team thread",
    scenario_category: 'ccd',
    email: {
      sender: 'teamlead@company.com',
      subject: "Re: Deployment checklist for v2.5",
      body_text: `Hi team,

[CC: you, ops-team@company.com]

Here's the deployment checklist for v2.5 going out Thursday:

1. Database migration (Bob)
2. Feature flag rollout (Alice)
3. Load testing (Charlie)
4. Monitoring dashboard update (Dave)

@Bob - please confirm the migration script is tested.
@Alice - can you verify the feature flags are configured?

Everyone else is CC'd for visibility. No action needed from CC'd folks.

Thanks,
Tom`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['professional', 'neutral', 'direct'],
    },
  },
  {
    id: 'I2',
    name: "CC'd FYI announcement",
    scenario_category: 'ccd',
    email: {
      sender: 'cto@company.com',
      subject: 'New security policy effective immediately',
      body_text: `Team,

[CC: all-engineering@company.com]

Effective immediately, the following security changes are in place:

1. MFA required for all production access
2. SSH keys must be rotated every 90 days
3. New PR approval requirement: 2 reviewers for any infra changes

Documentation: wiki.company.com/security-policy-v2

Please review and comply. Reach out to security-team@company.com with questions.

Best,
CTO`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal', 'Urgent'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['formal', 'professional', 'direct', 'neutral', 'authoritative'],
    },
  },

  // ===== J: TONE DETECTION (3) =====
  {
    id: 'J1',
    name: 'Frustrated customer/colleague',
    scenario_category: 'tone',
    email: {
      sender: 'client@bigcorp.com',
      subject: 'RE: RE: RE: Still waiting on the fix',
      body_text: `This is the THIRD time I'm following up on this.

The bug I reported two weeks ago is STILL affecting our production environment. My team has been manually working around it every day, which is costing us significant time and money.

I was told it would be fixed "by end of last week." That deadline has clearly passed.

When can I expect this to actually be resolved? I need a concrete timeline, not another "we're looking into it."

Regards,
Mark`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['frustrated', 'annoyed', 'angry', 'irritated', 'upset'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'J2',
    name: 'Excited announcement',
    scenario_category: 'tone',
    email: {
      sender: 'cofounder@startup.com',
      subject: 'WE GOT THE FUNDING!! 🎉',
      body_text: `TEAM!!!

I am absolutely thrilled to share that we just closed our Series A!! $12M led by Sequoia!!!

This is a huge milestone for all of us. Every late night, every weekend push, every "one more feature" — it all paid off.

We're celebrating Friday evening at The Rooftop Bar at 7 PM. Drinks are on us (obviously 😄).

I literally cannot contain my excitement. You all are AMAZING.

— Alex`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: true, // Team celebration invite — socially expected to RSVP/attend
    },
    expected_analysis: {
      requires_reply: true, // Cofounder inviting team to drinks warrants a response
      deadline_expected: false,
      meeting_expected: true, // Celebration gathering is an event → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['excited', 'enthusiastic', 'thrilled', 'energetic'],
    },
  },
  {
    id: 'J3',
    name: 'Apologetic late response',
    scenario_category: 'tone',
    email: {
      sender: 'contractor@freelance.com',
      subject: 'Re: Design mockups - apologies for the delay',
      body_text: `Hi,

I'm really sorry for the late response. I've been dealing with some personal matters and completely dropped the ball on getting the mockups to you on time.

I've attached the updated designs now. I know this puts us behind schedule and I take full responsibility.

If you'd like to discuss a revised timeline or if there's anything I can do to make up for the delay, please let me know. I understand if you're frustrated.

Again, my sincere apologies.

Best,
Sam`,
      has_attachments: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['apologetic', 'sorry', 'remorseful', 'contrite'],
      min_questions: 1,
      max_questions: 3,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
  },

  // ===== K: ATTACHMENT DETECTION (2) =====
  {
    id: 'K1',
    name: 'Missing attachment warning',
    scenario_category: 'attachment',
    email: {
      sender: 'colleague@company.com',
      subject: 'Updated spec document',
      body_text: `Hi,

As discussed, I've attached the updated product spec with the changes we agreed on in the meeting.

Key updates:
- Revised user flow for onboarding
- Updated wireframes for the dashboard
- New API endpoint specifications

Let me know if you have any questions.

Best,
Emily`,
      has_attachments: false, // Says "attached" but has_attachments is false!
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      missing_attachment_expected: true,
      acceptable_tones: ['friendly', 'professional', 'neutral', 'casual'],
      min_questions: 0,
      max_questions: 3,
    },
  },
  {
    id: 'K2',
    name: 'Requesting attachment from recipient',
    scenario_category: 'attachment',
    email: {
      sender: 'accountant@firm.com',
      subject: 'Tax documents needed',
      body_text: `Hi,

For your 2024 tax filing, I'll need the following documents:

1. W-2 forms from all employers
2. 1099 forms (freelance income, investments)
3. Mortgage interest statement (1098)
4. Charitable donation receipts
5. Business expense receipts

Please send these as PDFs if possible. I'll need everything by ${daysFromNow(14)} to file on time.

Thank you,
Patricia Chen, CPA`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14),
      meeting_expected: false,
      expected_attachment_keywords: ['W-2', 'tax', '1099', 'PDF', 'receipts', 'documents'],
      acceptable_tones: ['professional', 'formal', 'neutral'],
      min_questions: 1,
      max_questions: 6,
    },
  },

  // ===== L: URGENCY EDGE CASES (3) =====
  {
    id: 'L1',
    name: 'ASAP / today urgency',
    scenario_category: 'urgency',
    email: {
      sender: 'ceo@company.com',
      subject: 'URGENT: Client presentation fix needed',
      body_text: `The demo dashboard is showing wrong numbers for our meeting with Acme Corp TODAY at 3 PM.

The revenue chart is pulling from last quarter's data instead of current. This needs to be fixed ASAP — the client will be looking at this in 4 hours.

Can you jump on this immediately? Drop whatever else you're working on.

Thanks`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      meeting_expected: true,
      acceptable_tones: ['urgent', 'direct', 'stressed', 'demanding', 'concerned'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'L2',
    name: 'Next week low urgency',
    scenario_category: 'urgency',
    email: {
      sender: 'hr@company.com',
      subject: 'Reminder: Submit your peer reviews',
      body_text: `Hi,

Friendly reminder that peer reviews for Q1 are due next Friday (${daysFromNow(8)}).

You have 3 reviews to complete:
- Sarah Chen
- Mike Johnson
- Lisa Park

Complete them in the HR portal: hr.company.com/reviews

This typically takes about 20-30 minutes per person.

Thanks,
HR Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(8),
      meeting_expected: false,
      acceptable_tones: ['friendly', 'neutral', 'professional', 'casual'],
    },
  },
  {
    id: 'L3',
    name: 'Register-by vs event-on confusion',
    scenario_category: 'urgency',
    email: {
      sender: 'hackathon@techorg.com',
      subject: 'Annual Hackathon - Register by ' + daysFromNow(3),
      body_text: `Hi developers!

Our Annual Hackathon is happening on ${daysFromNow(21)} - ${daysFromNow(22)}!

Registration deadline: ${daysFromNow(3)}
Team size: 2-5 people
Prizes: $10,000 grand prize

Important dates:
- Registration closes: ${daysFromNow(3)}
- Team formation mixer: ${daysFromNow(14)}
- Hackathon weekend: ${daysFromNow(21)} - ${daysFromNow(22)}

Register: techorg.com/hackathon/register

Don't miss out!`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(3),
      meeting_expected: true, // Hackathon is an event to attend → is_meeting=true, event_type="event"
      event_type: 'event',
      acceptable_tones: ['enthusiastic', 'excited', 'friendly', 'casual', 'promotional', 'neutral'],
    },
  },

  // ===== M: EDGE CASES (12) =====
  {
    id: 'M1',
    name: 'Past meeting reference (no scheduling)',
    scenario_category: 'edge-case',
    email: {
      sender: 'teammate@company.com',
      subject: 'Re: Follow-up from Thursday meeting',
      body_text: `Hi,

The meeting last Thursday went really well. I think the client was impressed with our demo.

I've compiled the action items from the meeting notes:
1. Send updated proposal by next week
2. Schedule follow-up demo in 2 weeks
3. Get sign-off from legal on the contract terms

Let me know if I missed anything.

Thanks,
Jordan`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false, // Past meeting reference, NOT scheduling a new one
      acceptable_tones: ['friendly', 'professional', 'neutral', 'positive', 'casual'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'M2',
    name: 'Past deadline with extension',
    scenario_category: 'edge-case',
    email: {
      sender: 'professor@university.edu',
      subject: 'Assignment deadline extended',
      body_text: `Dear students,

The original deadline for the midterm paper (March 1st) has passed, and I noticed several of you haven't submitted yet.

I'm extending the deadline to ${daysFromNow(5)}. Papers submitted after the original deadline but before the new deadline will receive a 10% late penalty.

No further extensions will be granted.

Professor Williams`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5), // Should extract the NEW deadline, not March 1st
      meeting_expected: false,
      acceptable_tones: ['formal', 'neutral', 'professional', 'authoritative', 'direct'],
    },
  },
  {
    id: 'M3',
    name: 'Deadline in email signature (should ignore)',
    scenario_category: 'edge-case',
    email: {
      sender: 'contact@consulting.com',
      subject: 'Project status update',
      body_text: `Hi,

Just wanted to let you know that Phase 2 is on track. The development team completed the API integration yesterday and QA testing begins tomorrow.

No blockers at this time. I'll send the weekly report on Friday as usual.

Best,
Angela Martinez
Senior Consultant | TechConsulting Inc.
Please respond within 5 business days to maintain SLA compliance.
This email may contain confidential information.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false, // "5 business days" is in signature boilerplate
      meeting_expected: false,
      acceptable_tones: ['professional', 'neutral', 'friendly', 'informative'],
    },
  },
  {
    id: 'M4',
    name: 'Multiple deadlines in one email',
    scenario_category: 'edge-case',
    email: {
      sender: 'program@gradschool.edu',
      subject: 'Important dates for spring semester',
      body_text: `Dear student,

Please note the following important deadlines for this semester:

1. Course add/drop deadline: ${daysFromNow(3)}
2. Submit your thesis proposal: ${daysFromNow(14)}
3. Financial aid application: ${daysFromNow(21)}
4. Final thesis submission: ${daysFromNow(60)}

Missing any of these deadlines may affect your enrollment status.

Office of Graduate Studies`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(3), // Should extract the EARLIEST upcoming deadline
      meeting_expected: false,
      expected_life_data_types: ['deadline'],
      acceptable_tones: ['formal', 'professional', 'neutral', 'informative'],
    },
  },
  {
    id: 'M5',
    name: 'Empty body email (subject only)',
    scenario_category: 'edge-case',
    email: {
      sender: 'unknown@random.com',
      subject: 'Checking in',
      body_text: '',
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'casual', 'friendly'],
    },
  },
  {
    id: 'M6',
    name: 'Phishing / scam email',
    scenario_category: 'edge-case',
    email: {
      sender: 'security-alert@bank-0f-america.suspicious.com',
      subject: 'URGENT: Your account has been compromised!',
      body_text: `Dear Valued Customer,

We have detected suspicious activity on your Bank of America account. Your account has been temporarily suspended for your protection.

To restore access, please verify your identity immediately by clicking the link below:

http://bank-0f-america.suspicious.com/verify?id=12345

You must verify within 24 hours or your account will be permanently closed.

If you did not authorize this transaction of $4,999.00, please click the link above immediately.

Bank of America Security Team
This is an automated message. Do not reply.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false, // Phishing urgency should not be treated as real deadline
      meeting_expected: false,
      acceptable_tones: ['urgent', 'alarming', 'suspicious', 'threatening', 'demanding', 'deceptive', 'formal'],
    },
  },
  {
    id: 'M7',
    name: 'Forwarded email chain',
    scenario_category: 'edge-case',
    email: {
      sender: 'boss@company.com',
      subject: 'Fwd: Client feedback on prototype',
      body_text: `FYI - see below. Thoughts?

---------- Forwarded message ----------
From: client@bigcorp.com
Date: ${daysFromNow(-2)}
Subject: Feedback on prototype

Hi team,

We reviewed the prototype and have some concerns:
1. The dashboard loading time is too slow (>5 seconds)
2. The export feature doesn't support CSV format
3. The color scheme doesn't match our brand guidelines

These need to be addressed before we can proceed to Phase 2. Can you provide an updated timeline?

Thanks,
Robert Chen
VP of Engineering, BigCorp`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'direct', 'concerned', 'casual'],
      min_questions: 1,
      max_questions: 4,
    },
  },
  {
    id: 'M8',
    name: 'Decision needed without explicit question',
    scenario_category: 'edge-case',
    email: {
      sender: 'designer@company.com',
      subject: 'Design direction for landing page',
      body_text: `Hi,

I've narrowed the landing page redesign down to two directions:

Option A: Bold, modern look with animated hero section and dark theme
Option B: Clean, minimal design with lots of whitespace and light colors

I'm leaning toward Option A since it aligns better with our recent brand refresh, but I want to make sure you're on board before I invest time in the full mockups.

I'll go with Option A unless I hear otherwise by ${daysFromNow(2)}.

Cheers,
Maya`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(2),
      meeting_expected: false,
      acceptable_tones: ['friendly', 'casual', 'professional', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'M9',
    name: '"Let me know" in newsletter (false positive test)',
    scenario_category: 'edge-case',
    email: {
      sender: 'newsletter@techblog.com',
      subject: 'This month in open source',
      body_text: `THE OPEN SOURCE MONTHLY

Top Projects This Month:
1. Rust 2.0 announcement shakes up systems programming
2. New React Server Components stable release
3. SQLite adds vector search support
4. Go generics adoption hits 80% in new projects

Community Spotlight: Building a CLI tool in Zig
Tutorial: Getting started with WebAssembly

If you enjoyed this issue, let me know what topics you'd like to see covered next month!

Unsubscribe: techblog.com/unsub
You received this because you're subscribed to The Open Source Monthly.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false, // "Let me know" is a courtesy, not a real question
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'informative', 'friendly', 'casual', 'enthusiastic'],
    },
  },
  {
    id: 'M10',
    name: 'Job change life intel buried in email',
    scenario_category: 'edge-case',
    email: {
      sender: 'oldfriend@gmail.com',
      subject: 'Long time no talk!',
      body_text: `Hey!

It's been forever since we caught up. How have you been?

A lot has changed on my end - I finally left my job at Google and joined a startup called NeuralPath as their CTO. It's been a wild ride so far. Also, Sarah and I got engaged last month! We're planning a summer wedding.

We should grab dinner sometime soon. Are you free next week?

Miss you!
Dave`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true, // "grab dinner next week" is a casual meeting request
      acceptable_tones: ['friendly', 'warm', 'casual', 'excited', 'enthusiastic'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'M11',
    name: 'Auto-reply / out of office',
    scenario_category: 'edge-case',
    email: {
      sender: 'colleague@company.com',
      subject: 'Out of Office: Re: Project update',
      body_text: `Thank you for your email. I am currently out of the office from February 24 to March 3 with limited access to email.

For urgent matters, please contact my backup, Sarah Chen, at sarah.chen@company.com.

I will respond to your email upon my return.

Best regards,
Tom`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'formal', 'automated'],
    },
  },
  {
    id: 'M12',
    name: 'Subscription renewal requiring cancellation decision',
    scenario_category: 'edge-case',
    email: {
      sender: 'billing@gymchain.com',
      subject: 'Your annual membership renews in 7 days',
      body_text: `Hi,

Your Platinum Gym Membership will automatically renew on ${daysFromNow(7)}.

Membership: Platinum All-Access
Annual fee: $599.00
Payment method: Mastercard ending in 5678

To cancel or downgrade your membership, you must do so before ${daysFromNow(7)}. After renewal, no refunds will be issued.

Manage membership: gymchain.com/account

GymChain Fitness`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(7), // Must cancel BEFORE this date
      meeting_expected: false,
      expected_life_data_types: ['subscription'],
      acceptable_tones: ['neutral', 'professional', 'informative', 'formal'],
    },
  },

  // ===== N: DEADLINE DISPLAY EDGE CASES (4) =====
  {
    id: 'N1',
    name: 'Deadline is today',
    scenario_category: 'deadline-display',
    email: {
      sender: 'teacher@school.edu',
      subject: 'Homework due TODAY',
      body_text: `Reminder: Your homework assignment is due today, ${daysFromNow(0)}.

Please submit your completed worksheet via the student portal before midnight.

If you're having trouble, reach out to me before 5 PM.

Mrs. Johnson`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(0),
      meeting_expected: false,
      expected_deadline_display: 'Due today',
      deadline_must_coexist_with_category: true,
      acceptable_tones: ['professional', 'neutral', 'direct', 'formal'],
    },
  },
  {
    id: 'N2',
    name: 'Deadline is tomorrow',
    scenario_category: 'deadline-display',
    email: {
      sender: 'coordinator@conference.org',
      subject: 'Speaker bio due tomorrow',
      body_text: `Hi,

Just a quick reminder that we need your speaker bio and headshot by tomorrow (${daysFromNow(1)}) to finalize the event program.

Please send:
- 150-word bio
- High-res headshot (300dpi)

Thanks!
Event Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(1),
      meeting_expected: false,
      expected_deadline_display: 'Due tomorrow',
      deadline_must_coexist_with_category: true,
      acceptable_tones: ['friendly', 'professional', 'neutral', 'casual'],
      min_questions: 0,
      max_questions: 3,
    },
  },
  {
    id: 'N3',
    name: 'Deadline was yesterday (overdue)',
    scenario_category: 'deadline-display',
    email: {
      sender: 'manager@company.com',
      subject: 'Overdue: Expense report',
      body_text: `Hi,

Your expense report was due yesterday (${daysFromNow(-1)}). Please submit it ASAP so we can process reimbursements this pay cycle.

The finance team is waiting on 3 reports including yours.

Thanks,
Admin`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(-1),
      meeting_expected: false,
      expected_deadline_display: 'Overdue by 1 day',
      deadline_must_coexist_with_category: true,
      acceptable_tones: ['professional', 'direct', 'neutral', 'urgent'],
    },
  },
  {
    id: 'N4',
    name: 'Deadline in 14 days (not urgent)',
    scenario_category: 'deadline-display',
    email: {
      sender: 'grants@foundation.org',
      subject: 'Grant application deadline reminder',
      body_text: `Dear applicant,

This is an early reminder that your research grant application is due on ${daysFromNow(14)}.

Please ensure all supporting documents are uploaded by the deadline. Late submissions will not be accepted.

Research Grants Office`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14),
      meeting_expected: false,
      expected_deadline_display: 'Due in 14 days',
      acceptable_tones: ['formal', 'professional', 'neutral'],
    },
  },

  // ===== O: CRM-FOCUSED (3) =====
  {
    id: 'O1',
    name: 'Email from named sender for CRM parsing',
    scenario_category: 'crm',
    email: {
      sender: 'John Smith <john.smith@bigcorp.com>',
      subject: 'Follow up on our conversation',
      body_text: `Hi,

Great chatting with you at the conference last week. I wanted to follow up on the partnership opportunity we discussed.

Would you be open to a 30-minute call next week to explore this further?

Best,
John Smith
VP of Business Development, BigCorp Inc.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      expected_crm_category: 'Client',
      acceptable_tones: ['professional', 'friendly', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'O2',
    name: 'Noreply sender should not create CRM contact',
    scenario_category: 'crm',
    email: {
      sender: 'noreply@service.com',
      subject: 'Your account settings have been updated',
      body_text: `Your account settings were updated on ${daysFromNow(0)}.

Changes made:
- Email notification preferences updated
- Two-factor authentication enabled

If you did not make these changes, please contact support immediately.

This is an automated message. Do not reply.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'formal', 'automated'],
    },
  },
  {
    id: 'O3',
    name: 'Recurring sender with relationship context',
    scenario_category: 'crm',
    email: {
      sender: 'alice.wong@team.company.com',
      subject: 'Re: Re: Re: Re: Weekly sync notes',
      body_text: `Hey,

Same as always — here are the sync notes from today:
- Feature X is on track for next sprint
- Bug Y was hotfixed this morning
- Need to discuss resource allocation in our 1:1

Talk soon!
Alice`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_crm_category: 'Colleague',
      acceptable_tones: ['casual', 'friendly', 'neutral'],
    },
  },

  // ===== P: LIFE INTEL COMPLETENESS (4) =====
  {
    id: 'P1',
    name: 'Netflix subscription renewal with amount',
    scenario_category: 'life-intel',
    email: {
      sender: 'info@netflix.com',
      subject: 'Your Netflix subscription has been renewed',
      body_text: `Hi,

Your Netflix Premium subscription has been renewed.

Amount: $15.99/month
Next billing date: ${daysFromNow(30)}
Payment method: Visa ending in 1234

Manage your subscription at netflix.com/account

Thanks for being a Netflix member!`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['subscription'],
      expected_life_data_fields: [{
        data_type: 'subscription',
        amount: 15.99,
        currency: 'USD',
        frequency: 'monthly',
      }],
      acceptable_tones: ['neutral', 'professional', 'informative', 'friendly'],
    },
  },
  {
    id: 'P2',
    name: 'Flight confirmation with full travel details',
    scenario_category: 'life-intel',
    email: {
      sender: 'reservations@united.com',
      subject: 'Your flight confirmation - UA 891',
      body_text: `Confirmation Number: XYZ789

Passenger: Jane Doe

Flight: UA 891
Date: ${daysFromNow(14)}
Route: LAX → ORD
Depart: 7:30 AM PT → Arrive: 1:45 PM CT

Return: UA 456
Date: ${daysFromNow(18)}
Route: ORD → LAX
Depart: 5:00 PM CT → Arrive: 7:15 PM PT

Total fare: $342.50

Manage your trip at united.com/manage`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['travel'],
      expected_life_data_fields: [{
        data_type: 'travel',
        carrier: 'United',
        confirmation_number: 'XYZ789',
      }],
      acceptable_tones: ['neutral', 'professional', 'formal', 'informative'],
    },
  },
  {
    id: 'P3',
    name: 'Package tracking with carrier details',
    scenario_category: 'life-intel',
    email: {
      sender: 'tracking@ups.com',
      subject: 'UPS: Your package is on the way',
      body_text: `Tracking Number: 1Z999AA10123456784

Your package is in transit.

From: Amazon Fulfillment Center, Louisville KY
To: 123 Main St, San Francisco CA

Estimated delivery: ${daysFromNow(2)}
Current status: In transit - Oakland, CA

Track at ups.com/track`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['package'],
      expected_life_data_fields: [{
        data_type: 'package',
        carrier: 'UPS',
        tracking_number: '1Z999AA10123456784',
      }],
      acceptable_tones: ['neutral', 'informative'],
    },
  },
  {
    id: 'P4',
    name: 'Email with NO life data (no hallucination)',
    scenario_category: 'life-intel',
    email: {
      sender: 'colleague@work.com',
      subject: 'Thoughts on the new logo?',
      body_text: `Hey,

The design team just shared three options for the new company logo. I personally like Option B — it feels modern without being too trendy.

What do you think? We need to pick one by end of week for the rebrand launch.

Cheers,
Pat`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: [], // Empty — no life data should be extracted
      acceptable_tones: ['casual', 'friendly', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },

  // ===== Q: CROSS-DIMENSION CONSISTENCY (4) =====
  {
    id: 'Q1',
    name: 'Urgent email with deadline — both must be set',
    scenario_category: 'cross-dimension',
    email: {
      sender: 'legal@company.com',
      subject: 'URGENT: Sign contract by EOD tomorrow',
      body_text: `This is time-sensitive.

The vendor contract must be signed and returned by end of day tomorrow (${daysFromNow(1)}). If we miss this deadline, we lose the negotiated rate and will need to restart the procurement process.

The signed copy should go to legal@company.com and procurement@company.com.

Regards,
Legal Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(1),
      meeting_expected: false,
      deadline_must_coexist_with_category: true,
      expected_deadline_display: 'Due tomorrow',
      acceptable_tones: ['urgent', 'direct', 'professional', 'formal'],
      min_questions: 0,
      max_questions: 2,
    },
  },
  {
    id: 'Q2',
    name: 'Newsletter mentioning dates — no deadline, no meeting',
    scenario_category: 'cross-dimension',
    email: {
      sender: 'newsletter@industryreport.com',
      subject: 'Industry Roundup: Key dates for Q2',
      body_text: `INDUSTRY ROUNDUP — Q2 2026

Key dates to watch:
- ${daysFromNow(15)}: Apple expected to announce new MacBook line
- ${daysFromNow(30)}: EU GDPR enforcement deadline for new compliance rules
- ${daysFromNow(45)}: Annual FinTech Summit in London

Analysis: What the Fed rate decision means for tech valuations
Feature: Top 10 AI startups to watch in 2026

Unsubscribe: industryreport.com/unsub`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'informative', 'professional', 'casual'],
    },
  },
  {
    id: 'Q3',
    name: 'Event invite (not a meeting) — correct event_type',
    scenario_category: 'cross-dimension',
    email: {
      sender: 'events@alumni.edu',
      subject: 'Alumni Networking Mixer — You\'re Invited!',
      body_text: `Dear alumni,

Join us for our Spring Networking Mixer on ${daysFromNow(10)}!

Time: 6:00 PM - 9:00 PM
Location: The Grand Ballroom, Downtown Hotel
Dress code: Business casual
Complimentary appetizers and drinks

No RSVP needed — just show up!

See you there,
Alumni Association`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'event',
      acceptable_tones: ['friendly', 'enthusiastic', 'professional', 'neutral'],
    },
  },
  {
    id: 'Q4',
    name: 'Informal "let me know by Friday" is a real deadline',
    scenario_category: 'cross-dimension',
    email: {
      sender: 'teammate@company.com',
      subject: 'Volunteering for the demo',
      body_text: `Hey!

We need someone to present the new feature at the all-hands next week. I was thinking you'd be great for it since you built most of it.

Let me know by Friday (${nextFriday}) if you're up for it so I can finalize the agenda.

No pressure either way!

Thanks,
Sam`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: nextFriday,
      meeting_expected: false,
      requires_reply_reasoning_keywords: ['deadline', 'respond', 'Friday', 'agenda'],
      acceptable_tones: ['friendly', 'casual', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },

  // ===== R: E-COMMERCE & RECEIPTS (5) =====
  {
    id: 'R1',
    name: 'Amazon order confirmation',
    scenario_category: 'ecommerce',
    email: {
      sender: 'auto-confirm@amazon.com',
      subject: 'Your Amazon.com order #112-9876543-2109876',
      body_text: `Hello,

Thank you for your order!

Order #112-9876543-2109876
Item: Anker USB-C Hub, 7-in-1 Adapter
Qty: 1
Price: $35.99
Tax: $2.88
Order total: $38.87

Estimated delivery: ${daysFromNow(4)}

Shipping to: 123 Main St, San Francisco, CA 94102

Track your package: amazon.com/track/12345

Thank you for shopping with us.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['order', 'package'],
      acceptable_tones: ['neutral', 'professional', 'informative', 'automated'],
    },
  },
  {
    id: 'R2',
    name: 'App Store digital receipt',
    scenario_category: 'ecommerce',
    email: {
      sender: 'no_reply@email.apple.com',
      subject: 'Your receipt from Apple',
      body_text: `Apple ID: user@icloud.com

RECEIPT
Date: ${daysFromNow(0)}

App Store
Notability - $4.99

Subtotal: $4.99
Tax: $0.40
Total: $5.39

Billed to: Visa ending in 4321

Apple ID Summary: appleid.apple.com`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['purchase'],
      acceptable_tones: ['neutral', 'professional', 'formal', 'automated'],
    },
  },
  {
    id: 'R3',
    name: 'Refund processed notification',
    scenario_category: 'ecommerce',
    email: {
      sender: 'returns@store.com',
      subject: 'Your refund has been processed',
      body_text: `Hi,

Your refund for order #ORD-88421 has been processed.

Refund amount: $64.99
Refund method: Original payment method (Visa ending in 7890)
Expected to appear: 3-5 business days

Refunded item: Wireless Bluetooth Speaker

If you have any questions, contact support at support@store.com.

Thank you,
Store Customer Service`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'informative', 'automated'],
    },
  },
  {
    id: 'R4',
    name: 'Return shipping label ready',
    scenario_category: 'ecommerce',
    email: {
      sender: 'returns@retailer.com',
      subject: 'Your return label is ready',
      body_text: `Hi,

Your return request has been approved.

Order: #RET-55102
Item: Running Shoes - Size 10
Reason: Wrong size

Please print the attached shipping label and drop off your package at any UPS location. Returns must be shipped within 14 days.

Once we receive the item, your refund will be processed within 3-5 business days.

Retailer Returns Team`,
      has_attachments: true,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true, // "within 14 days" is a soft deadline
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'informative'],
    },
  },
  {
    id: 'R5',
    name: 'Order delayed with new ETA',
    scenario_category: 'ecommerce',
    email: {
      sender: 'updates@shop.com',
      subject: 'Update on your order #SH-90213',
      body_text: `Hi,

We wanted to let you know that your order #SH-90213 has been delayed.

Original delivery estimate: ${daysFromNow(-1)}
New estimated delivery: ${daysFromNow(5)}

Item: Standing Desk Converter
Reason: Shipping carrier delay

We apologize for the inconvenience. No action is needed on your part.

If you'd like to cancel, visit shop.com/orders.

Shop Customer Care`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false, // ETA is informational, not a deadline for the user
      meeting_expected: false,
      expected_life_data_types: ['package', 'order'],
      acceptable_tones: ['apologetic', 'neutral', 'professional', 'informative'],
    },
  },

  // ===== S: HEALTHCARE & APPOINTMENTS (4) =====
  {
    id: 'S1',
    name: 'Doctor appointment reminder',
    scenario_category: 'healthcare',
    email: {
      sender: 'noreply@medicalcenter.com',
      subject: 'Appointment reminder - Tomorrow at 2:00 PM',
      body_text: `Appointment Reminder

Patient: You
Provider: Dr. Sarah Kim, MD
Date: ${daysFromNow(1)} at 2:00 PM
Location: Downtown Medical Center, Suite 400
Type: Annual physical exam

Please arrive 15 minutes early to complete paperwork. Bring your insurance card and photo ID.

To cancel or reschedule, call (555) 123-4567 at least 24 hours in advance.

Downtown Medical Center`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true, // Doctor appointment is a scheduled event
      event_type: 'meeting',
      expected_deadline_display: 'Due tomorrow',
      acceptable_tones: ['neutral', 'professional', 'formal', 'informative'],
    },
  },
  {
    id: 'S2',
    name: 'Prescription ready for pickup',
    scenario_category: 'healthcare',
    email: {
      sender: 'pharmacy@cvs.com',
      subject: 'Your prescription is ready for pickup',
      body_text: `Hello,

Your prescription is ready for pickup at CVS Pharmacy.

Rx #: 7654321
Medication: Amoxicillin 500mg
Prescriber: Dr. Kim
Store: CVS #4521 - 456 Oak Ave

Pickup hours: Mon-Sat 8am-9pm, Sun 10am-6pm

Prescriptions not picked up within 10 days will be returned to stock.

CVS Pharmacy`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'informative', 'automated'],
    },
  },
  {
    id: 'S3',
    name: 'Insurance claim processed',
    scenario_category: 'healthcare',
    email: {
      sender: 'claims@healthinsurance.com',
      subject: 'Your claim has been processed - EOB enclosed',
      body_text: `Explanation of Benefits

Claim #: CLM-2026-445678
Date of service: ${daysFromNow(-14)}
Provider: Downtown Medical Center
Service: Annual physical exam

Billed amount: $350.00
Insurance paid: $315.00
Your responsibility: $35.00 (copay)

This is not a bill. You may receive a separate bill from your provider.

View details at healthinsurance.com/claims`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['insurance'],
      acceptable_tones: ['neutral', 'professional', 'formal', 'informative'],
    },
  },
  {
    id: 'S4',
    name: 'Lab results available via portal',
    scenario_category: 'healthcare',
    email: {
      sender: 'noreply@myhealth.com',
      subject: 'New lab results available',
      body_text: `Hello,

New lab results have been posted to your MyHealth portal.

Test: Comprehensive Metabolic Panel
Ordered by: Dr. Sarah Kim
Date collected: ${daysFromNow(-3)}

Log in to view your results: myhealth.com/results

If you have questions about your results, please contact your provider's office.

MyHealth Portal`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'informative', 'automated'],
    },
  },

  // ===== T: GOVERNMENT & LEGAL (4) =====
  {
    id: 'T1',
    name: 'Jury duty summons',
    scenario_category: 'government',
    email: {
      sender: 'juryduty@courts.gov',
      subject: 'Jury Duty Summons - Report Date ' + daysFromNow(21),
      body_text: `OFFICIAL JURY DUTY SUMMONS

You are hereby summoned to appear for jury duty.

Report date: ${daysFromNow(21)}
Report time: 8:00 AM
Location: County Courthouse, 200 Court St, Room 101

Juror ID: JUR-2026-88456

Failure to appear may result in a fine or contempt of court.

If you have a hardship or scheduling conflict, you must request a postponement before ${daysFromNow(14)} at courts.gov/jury/postpone.

Jury Commissioner's Office`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14), // Postponement deadline is the actionable one
      meeting_expected: false,
      acceptable_tones: ['formal', 'authoritative', 'official', 'professional', 'neutral'],
    },
  },
  {
    id: 'T2',
    name: 'Vehicle registration renewal',
    scenario_category: 'government',
    email: {
      sender: 'noreply@dmv.gov',
      subject: 'Vehicle registration renewal due',
      body_text: `California Department of Motor Vehicles

Your vehicle registration is due for renewal.

Vehicle: 2022 Honda Civic
License plate: 8ABC123
Registration expires: ${daysFromNow(30)}
Renewal fee: $285.00

Renew online at dmv.gov/renew or visit your local DMV office.

Late fees apply after the expiration date.

California DMV`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(30),
      meeting_expected: false,
      expected_life_data_types: ['bill'],
      acceptable_tones: ['formal', 'neutral', 'professional', 'official'],
    },
  },
  {
    id: 'T3',
    name: 'Tax refund deposited',
    scenario_category: 'government',
    email: {
      sender: 'noreply@irs.gov',
      subject: 'Your tax refund has been deposited',
      body_text: `Internal Revenue Service

Your federal tax refund has been direct deposited.

Tax year: 2025
Refund amount: $2,847.00
Deposit date: ${daysFromNow(0)}
Account: Checking ending in 5678

If you have questions, visit irs.gov/refunds.

This is an automated notification. Do not reply.`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      expected_life_data_types: ['financial'],
      acceptable_tones: ['neutral', 'formal', 'professional', 'automated'],
    },
  },
  {
    id: 'T4',
    name: 'Lease renewal offer with decision deadline',
    scenario_category: 'government',
    email: {
      sender: 'manager@apartments.com',
      subject: 'Your lease renewal offer',
      body_text: `Dear Resident,

Your current lease expires on ${daysFromNow(60)}. We'd love to have you stay!

Renewal options:
- 12-month lease: $2,450/month (current rate)
- Month-to-month: $2,850/month

Please let us know your decision by ${daysFromNow(30)}. If we don't hear from you, we'll assume you intend to vacate and begin showing the unit.

To renew, log in to the resident portal or reply to this email.

Best regards,
Oakwood Apartments Management`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(30),
      meeting_expected: false,
      acceptable_tones: ['professional', 'friendly', 'neutral', 'formal'],
      min_questions: 1,
      max_questions: 3,
    },
  },

  // ===== U: JOB & CAREER (4) =====
  {
    id: 'U1',
    name: 'Job offer with response deadline',
    scenario_category: 'career',
    email: {
      sender: 'hr@dreamcompany.com',
      subject: 'Offer Letter - Senior Software Engineer',
      body_text: `Dear Candidate,

We are pleased to extend an offer of employment for the position of Senior Software Engineer.

Compensation:
- Base salary: $185,000/year
- Signing bonus: $20,000
- Equity: 10,000 RSUs vesting over 4 years
- Start date: ${daysFromNow(30)}

Please review the attached offer letter and respond by ${daysFromNow(5)} to accept or discuss.

We're excited about the possibility of you joining our team!

Best regards,
Emily Chen
Head of People, DreamCompany`,
      has_attachments: true,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: false,
      acceptable_tones: ['professional', 'enthusiastic', 'friendly', 'formal', 'warm'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'U2',
    name: 'Job rejection email',
    scenario_category: 'career',
    email: {
      sender: 'recruiting@company.com',
      subject: 'Update on your application - Software Engineer',
      body_text: `Dear Applicant,

Thank you for your interest in the Software Engineer position at Company and for taking the time to interview with us.

After careful consideration, we have decided to move forward with another candidate whose experience more closely aligns with our current needs.

We were impressed with your skills and encourage you to apply for future openings. We'll keep your resume on file.

We wish you the best in your career.

Regards,
Company Recruiting Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'neutral', 'sympathetic', 'polite'],
    },
  },
  {
    id: 'U3',
    name: 'Performance review scheduled',
    scenario_category: 'career',
    email: {
      sender: 'manager@company.com',
      subject: 'Your performance review - ' + daysFromNow(7),
      body_text: `Hi,

Your annual performance review has been scheduled.

Date: ${daysFromNow(7)} at 10:00 AM
Location: Conference Room B / Zoom link below
Duration: 45 minutes

Please come prepared with:
- Your self-assessment (due before the meeting)
- Key accomplishments from the past year
- Goals for the upcoming year

Zoom: https://zoom.us/j/9876543210

Looking forward to our conversation.

Best,
David`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['professional', 'neutral', 'friendly', 'encouraging'],
    },
  },
  {
    id: 'U4',
    name: 'Recruiter cold outreach',
    scenario_category: 'career',
    email: {
      sender: 'recruiter@staffingfirm.com',
      subject: 'Exciting opportunity - Staff Engineer at FinTech startup',
      body_text: `Hi there,

I came across your profile and think you'd be a great fit for a Staff Engineer role at a well-funded Series B FinTech startup.

Highlights:
- $200-240K base + equity
- Remote-first, async culture
- Small team, big impact

I'd love to set up a quick 15-minute call to share more details. Would you be open to chatting?

No worries if the timing isn't right — happy to keep in touch for future opportunities.

Best,
Amanda Torres
Senior Recruiter, TechStaffing`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'professional', 'enthusiastic', 'casual', 'promotional'],
    },
  },

  // ===== V: PERSONAL & SOCIAL (5) =====
  {
    id: 'V1',
    name: 'Birthday party invite with RSVP date',
    scenario_category: 'personal',
    email: {
      sender: 'bestfriend@gmail.com',
      subject: "You're invited! Jake's 30th Birthday Bash",
      body_text: `Hey!!

Jake is turning 30 and we're throwing him a surprise party!

Date: ${daysFromNow(14)} (Saturday)
Time: 7:00 PM
Where: The Backyard Bar & Grill, 789 Elm St

IMPORTANT: Please RSVP by ${daysFromNow(7)} so we can finalize the reservation.

Also it's a SURPRISE so please don't mention it to Jake!!

Can't wait to see you there!
— Lisa`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(7),
      meeting_expected: true,
      event_type: 'event',
      acceptable_tones: ['excited', 'friendly', 'enthusiastic', 'casual', 'warm'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'V2',
    name: 'Baby shower invitation',
    scenario_category: 'personal',
    email: {
      sender: 'sister@gmail.com',
      subject: 'Baby Shower for Emily - Save the Date!',
      body_text: `Hi everyone!

Please join us for a baby shower celebrating Emily and the upcoming arrival of Baby Girl Thompson!

Date: ${daysFromNow(21)}
Time: 2:00 PM - 5:00 PM
Location: Mom's house, 456 Maple Dr

Emily is registered at Target and Amazon.

Please let me know if you can make it!

Love,
Kate`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'event',
      acceptable_tones: ['warm', 'friendly', 'excited', 'enthusiastic', 'casual'],
      min_questions: 1,
      max_questions: 2,
    },
  },
  {
    id: 'V3',
    name: 'Condolence / sympathy message',
    scenario_category: 'personal',
    email: {
      sender: 'colleague@company.com',
      subject: 'So sorry for your loss',
      body_text: `Hi,

I just heard about your grandmother's passing and I'm so sorry for your loss. She sounded like a wonderful person from the stories you've shared.

Please take all the time you need. Don't worry about the project — the team has it covered.

If there's anything I can do, whether it's bringing a meal or just being someone to talk to, please don't hesitate to reach out.

Thinking of you and your family.

Warmly,
Jessica`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['sympathetic', 'compassionate', 'warm', 'caring', 'supportive', 'empathetic'],
    },
  },
  {
    id: 'V4',
    name: 'Friend "let\'s catch up" with no specific plan',
    scenario_category: 'personal',
    email: {
      sender: 'oldfriend@yahoo.com',
      subject: 'We should hang out soon!',
      body_text: `Heyyyy

It's been SO long since we've hung out. I keep meaning to text you but life gets crazy you know?

We should grab coffee or something sometime. Maybe next month? No rush, just miss hanging out with you.

Hope you're doing well!!

— Tina`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false, // Vague "sometime" — no concrete plan
      acceptable_tones: ['friendly', 'casual', 'warm', 'enthusiastic'],
      min_questions: 1,
      max_questions: 2,
    },
  },
  {
    id: 'V5',
    name: 'Moving announcement / new address',
    scenario_category: 'personal',
    email: {
      sender: 'friend@gmail.com',
      subject: 'We moved!',
      body_text: `Hi everyone!

Big news — we finally moved to Portland! The move was exhausting but we're settling in and loving it so far.

New address:
321 Pine St, Apt 4B
Portland, OR 97201

If you're ever in the area, you have an open invitation to come visit!

Hope to see you soon.

— Marcus & Amy`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'excited', 'casual', 'warm', 'enthusiastic'],
    },
  },

  // ===== W: CALENDAR & SCHEDULING TOOLS (4) =====
  {
    id: 'W1',
    name: 'Calendly booking confirmation',
    scenario_category: 'scheduling',
    email: {
      sender: 'notifications@calendly.com',
      subject: 'New event: 30 Min Meeting with Alex Rivera',
      body_text: `Hi,

A new event has been scheduled.

Event: 30 Min Meeting
Date: ${daysFromNow(3)} at 11:00 AM PST
Invitee: Alex Rivera (alex@startup.com)

Location: Zoom — https://zoom.us/j/5551234567

Event details:
Alex Rivera scheduled a 30 Min Meeting via your Calendly.

Add to calendar: [Google Calendar] [Outlook] [iCal]

Manage event: calendly.com/events/abc123

Powered by Calendly`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['neutral', 'professional', 'informative', 'automated'],
    },
  },
  {
    id: 'W2',
    name: 'Doodle poll "vote for a time"',
    scenario_category: 'scheduling',
    email: {
      sender: 'noreply@doodle.com',
      subject: 'Vote now: Team offsite planning',
      body_text: `Hi,

Sarah Chen has invited you to vote on "Team Offsite Planning".

Proposed times:
- ${daysFromNow(10)} 10:00 AM
- ${daysFromNow(11)} 2:00 PM
- ${daysFromNow(12)} 10:00 AM

Cast your vote: doodle.com/poll/xyz789

Please vote by ${daysFromNow(5)} so we can finalize the schedule.

Powered by Doodle`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true, // Need to vote
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: false, // It's a poll, not a confirmed meeting yet
      acceptable_tones: ['neutral', 'professional', 'automated', 'informative'],
      min_questions: 1,
      max_questions: 2,
    },
  },
  {
    id: 'W3',
    name: 'Google Calendar invite format',
    scenario_category: 'scheduling',
    email: {
      sender: 'calendar-notification@google.com',
      subject: 'Invitation: Design Review @ ${daysFromNow(2)} 3pm',
      body_text: `You have been invited to the following event.

Design Review
When: ${daysFromNow(2)} 3:00 PM - 4:00 PM (PST)
Where: Google Meet - meet.google.com/abc-defg-hij
Calendar: your@email.com
Who:
  - organizer@company.com (organizer)
  - you@company.com
  - designer@company.com

Going? Yes - Maybe - No  More options

Invitation from Google Calendar: https://calendar.google.com/event?id=12345`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true, // Need to RSVP
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['neutral', 'professional', 'automated', 'informative'],
    },
  },
  {
    id: 'W4',
    name: 'Meeting cancelled notification',
    scenario_category: 'scheduling',
    email: {
      sender: 'calendar-notification@google.com',
      subject: 'Canceled: Weekly Product Sync',
      body_text: `This event has been canceled.

Weekly Product Sync
When: ${daysFromNow(1)} 11:00 AM - 11:30 AM (PST)
Where: Google Meet

Organizer: pm@company.com has canceled this event.

Message from organizer:
"Canceling this week's sync — nothing urgent to discuss. See you next week!"`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false, // Meeting was cancelled — should NOT be detected
      acceptable_tones: ['neutral', 'casual', 'professional', 'informative'],
    },
  },

  // ===== X: CUSTOMER SUPPORT & SURVEYS (4) =====
  {
    id: 'X1',
    name: 'Support ticket response "we\'re looking into it"',
    scenario_category: 'support',
    email: {
      sender: 'support@saasapp.com',
      subject: 'Re: [Ticket #4521] Export feature not working',
      body_text: `Hi,

Thank you for contacting SaaSApp Support.

We've received your report about the CSV export feature returning empty files. Our engineering team is investigating the issue.

Ticket #4521
Status: In Progress
Priority: High

We'll update you as soon as we have more information. No action is needed from you at this time.

Thank you for your patience.

SaaSApp Support Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['professional', 'neutral', 'polite', 'informative'],
    },
  },
  {
    id: 'X2',
    name: 'Satisfaction survey',
    scenario_category: 'support',
    email: {
      sender: 'feedback@service.com',
      subject: 'How was your experience? Quick survey',
      body_text: `Hi,

You recently contacted our support team. We'd love to hear about your experience!

How would you rate your support interaction?

[1 star] [2 stars] [3 stars] [4 stars] [5 stars]

Your feedback helps us improve. This survey takes less than 1 minute.

Take survey: service.com/survey/12345

Thank you!
Service Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false, // Survey — not a real reply needed
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'neutral', 'professional', 'casual'],
    },
  },
  {
    id: 'X3',
    name: 'Feature request acknowledged',
    scenario_category: 'support',
    email: {
      sender: 'product@tool.com',
      subject: 'Thanks for your feature request!',
      body_text: `Hi,

Thank you for suggesting dark mode for our mobile app!

We've added this to our feature request tracker. While we can't guarantee a timeline, your feedback helps us prioritize our roadmap.

You can track the status of this request and vote on other features at tool.com/roadmap.

Thanks for helping us make Tool better!

The Tool Product Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'neutral', 'professional', 'appreciative'],
    },
  },
  {
    id: 'X4',
    name: 'Warranty expiration notice',
    scenario_category: 'support',
    email: {
      sender: 'warranty@electronics.com',
      subject: 'Your warranty expires soon',
      body_text: `Dear Customer,

Your warranty for the following product is expiring soon.

Product: ProBook Laptop 15
Serial: PB-2024-78901
Purchase date: ${daysFromNow(-350)}
Warranty expires: ${daysFromNow(15)}

Extend your warranty for an additional 2 years for $149.99.

Extend now: electronics.com/warranty/extend

After expiration, repairs will be charged at standard service rates.

Electronics Support`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(15),
      meeting_expected: false,
      expected_life_data_types: ['subscription'],
      acceptable_tones: ['professional', 'neutral', 'informative', 'formal'],
    },
  },

  // ===== Y: VENDOR & CONTRACTOR (4) =====
  {
    id: 'Y1',
    name: 'Contractor invoice with NET 30 terms',
    scenario_category: 'vendor',
    email: {
      sender: 'mike@mikedesign.com',
      subject: 'Invoice #2026-015 - Website redesign',
      body_text: `INVOICE

Invoice #: 2026-015
Date: ${daysFromNow(0)}
Due date: ${daysFromNow(30)} (NET 30)

Bill to: Your Company LLC

Services:
- Website redesign (40 hours @ $125/hr): $5,000.00
- Logo variations (5 concepts): $750.00
- Brand guidelines document: $500.00

Subtotal: $6,250.00
Tax: $0.00
Total due: $6,250.00

Payment methods:
- ACH: Routing 123456789, Account 987654321
- Check: Mike Design LLC, 789 Creative Ave

Thank you for your business!

Mike Thompson
Mike Design LLC`,
      has_attachments: true,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(30),
      meeting_expected: false,
      expected_life_data_types: ['bill'],
      acceptable_tones: ['professional', 'neutral', 'formal'],
    },
  },
  {
    id: 'Y2',
    name: 'Vendor quote with validity deadline',
    scenario_category: 'vendor',
    email: {
      sender: 'sales@cloudvendor.com',
      subject: 'Quote #QT-8834 - Enterprise Cloud Package',
      body_text: `Hi,

Thank you for your interest in our Enterprise Cloud Package. Please find our quote below.

Quote #QT-8834
Valid until: ${daysFromNow(14)}

Enterprise Cloud Package (annual):
- 100 TB storage: $12,000
- 50 compute instances: $18,000
- Premium support: $6,000
- Total: $36,000/year (15% discount from list price)

This quote is valid for 14 days. After that, we'd need to requote as pricing may change.

Please let me know if you'd like to proceed or if you have questions.

Best,
Jason Park
Account Executive, CloudVendor`,
      has_attachments: true,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14),
      meeting_expected: false,
      acceptable_tones: ['professional', 'friendly', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'Y3',
    name: 'SLA violation warning',
    scenario_category: 'vendor',
    email: {
      sender: 'alerts@hostingprovider.com',
      subject: 'SLA Violation Notice - Uptime Below Threshold',
      body_text: `URGENT: SLA VIOLATION NOTICE

Account: Your Company - Enterprise Plan
Period: ${daysFromNow(-30)} to ${daysFromNow(0)}
Guaranteed uptime: 99.95%
Actual uptime: 99.82%

Incidents contributing to downtime:
1. ${daysFromNow(-10)}: Database failover (47 min)
2. ${daysFromNow(-5)}: Network maintenance overrun (22 min)
3. ${daysFromNow(-2)}: API gateway timeout (18 min)

Per your SLA agreement, you are eligible for service credits. Please submit a credit request within 30 days at hostingprovider.com/sla-claims.

If you'd like to discuss remediation steps, please contact your account manager immediately.

HostingProvider Operations Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'urgent', 'direct', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'Y4',
    name: 'Contract auto-renewal reminder',
    scenario_category: 'vendor',
    email: {
      sender: 'contracts@softwarevendor.com',
      subject: 'Contract renewal notice - Annual license',
      body_text: `Dear Customer,

This is a reminder that your software license agreement will automatically renew on ${daysFromNow(30)}.

Contract: ENT-2025-4490
Product: SoftwareVendor Enterprise Suite
Term: 12 months
Annual fee: $24,000

If you wish to make changes or cancel your subscription, please notify us in writing at least 15 days before the renewal date (by ${daysFromNow(15)}).

Otherwise, your contract will renew under the same terms.

SoftwareVendor Contracts Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(15), // Cancellation deadline, not renewal date
      meeting_expected: false,
      expected_life_data_types: ['subscription'],
      acceptable_tones: ['professional', 'formal', 'neutral', 'informative'],
    },
  },

  // ===== Z: AMBIGUOUS & TRICKY (6) =====
  {
    id: 'Z1',
    name: 'Fake urgency in promo email',
    scenario_category: 'ambiguous',
    email: {
      sender: 'deals@cheapstuff.com',
      subject: 'LAST CHANCE!!! 🔥🔥🔥 Deal expires TONIGHT!!!',
      body_text: `⚠️ FINAL WARNING ⚠️

This is your LAST CHANCE to save BIG!!!

🔥 70% OFF EVERYTHING 🔥
⏰ ENDS TONIGHT AT MIDNIGHT ⏰

Our BIGGEST SALE EVER won't last!!!

Shop now before it's TOO LATE: cheapstuff.com/mega-sale

DON'T MISS OUT!!!

Unsubscribe: cheapstuff.com/unsub`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false, // Promotional urgency is not a real deadline
      meeting_expected: false,
      acceptable_tones: ['promotional', 'urgent', 'enthusiastic', 'spammy', 'aggressive'],
    },
  },
  {
    id: 'Z2',
    name: 'Deadline buried in long email',
    scenario_category: 'ambiguous',
    email: {
      sender: 'committee@org.com',
      subject: 'Annual Review Committee Update',
      body_text: `Dear Committee Members,

I hope this message finds you well. I wanted to take a moment to update everyone on the progress of the Annual Review process.

First, I'd like to thank everyone for their contributions during last month's preliminary assessments. The feedback was comprehensive and very useful. We've compiled the results into a summary document that you can find on the shared drive.

Second, regarding the revised evaluation criteria that were proposed at our last meeting, the board has approved the changes with minor modifications. The updated criteria sheet will be distributed next week.

Third, I want to remind everyone that we need to identify at least two external reviewers for each submission. This has been a challenge in past years, so I encourage you to start reaching out to your networks early. Please submit your list of proposed external reviewers by ${daysFromNow(10)}.

Finally, the venue for the annual awards ceremony has been booked for June 15th. More details to follow.

Best regards,
Dr. Thompson
Committee Chair`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true, // Deadline buried in paragraph 3 — must still detect it
      deadline_date_approx: daysFromNow(10),
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'neutral'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'Z3',
    name: 'One-word reply "Thanks"',
    scenario_category: 'ambiguous',
    email: {
      sender: 'colleague@company.com',
      subject: 'Re: Updated report',
      body_text: 'Thanks',
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['casual', 'friendly', 'neutral', 'brief'],
    },
  },
  {
    id: 'Z4',
    name: 'Subject-only email with realistic subject',
    scenario_category: 'ambiguous',
    email: {
      sender: 'boss@company.com',
      subject: 'Approved',
      body_text: '',
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Low', 'Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'direct', 'brief', 'casual', 'professional'],
    },
  },
  {
    id: 'Z5',
    name: 'Casual tone but hard deadline',
    scenario_category: 'ambiguous',
    email: {
      sender: 'pm@company.com',
      subject: 'hey quick thing',
      body_text: `hey no rush but actually we kinda need the API docs updated by ${nextFriday} because the partner team starts integration on Monday and they'll need the latest endpoints

sorry for the late notice lol i thought it was done already

can you squeeze it in? shouldn't take more than an hour or two

thanks!! 🙏`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: nextFriday,
      meeting_expected: false,
      acceptable_tones: ['casual', 'friendly', 'apologetic', 'informal'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'Z6',
    name: 'Passive-aggressive email',
    scenario_category: 'ambiguous',
    email: {
      sender: 'coworker@company.com',
      subject: 'Re: Re: Re: Re: Status update on deliverable',
      body_text: `Hi,

As per my last email (and the one before that), I still haven't received the deliverable that was originally due last Monday.

I'm sure you're very busy, but this is now holding up three other people on my team. I've copied our manager for visibility.

Per our team's process, deliverables are expected within 48 hours of the agreed deadline. I'm sure this was just an oversight.

Looking forward to receiving this at your earliest convenience.

Best,
Karen`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Urgent',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['passive-aggressive', 'frustrated', 'professional', 'formal', 'annoyed', 'sarcastic'],
      min_questions: 1,
      max_questions: 3,
    },
  },

  // ===== AA: INTERNAL COMPANY (5) =====
  {
    id: 'AA1',
    name: 'All-hands meeting announcement',
    scenario_category: 'internal',
    email: {
      sender: 'ceo@company.com',
      subject: 'All-Hands Meeting - Q1 Results & Q2 Plans',
      body_text: `Hi everyone,

Please join us for our quarterly All-Hands Meeting!

Date: ${daysFromNow(7)}
Time: 2:00 PM - 3:30 PM PST
Location: Main Auditorium + Zoom (link in calendar invite)

Agenda:
- Q1 financial results
- Product roadmap update
- New hires introduction
- Q&A

All team members are expected to attend. The recording will be available afterward for those in different time zones.

See you there,
CEO`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important', 'Low'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: true,
      event_type: 'event',
      acceptable_tones: ['professional', 'friendly', 'neutral', 'enthusiastic'],
    },
  },
  {
    id: 'AA2',
    name: 'Team reorg / reporting change',
    scenario_category: 'internal',
    email: {
      sender: 'vp-engineering@company.com',
      subject: 'Engineering team restructuring update',
      body_text: `Hi Engineering,

I wanted to share some organizational changes effective next Monday:

- The Platform team will merge with Infrastructure under James Lee
- A new Developer Experience team will be formed, led by Priya Patel
- The Mobile team will now report to the Consumer division

Your immediate manager will follow up with specifics on how this affects your team. Day-to-day work continues as usual during the transition.

I know change can be unsettling, but I believe this structure better positions us for our 2026 goals. Happy to answer questions in our next all-hands or via DM.

Best,
VP of Engineering`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'neutral', 'reassuring'],
    },
  },
  {
    id: 'AA3',
    name: 'Office closure / holiday notice',
    scenario_category: 'internal',
    email: {
      sender: 'hr@company.com',
      subject: 'Office closed - Presidents Day',
      body_text: `Hi team,

Reminder that our offices will be closed on Monday, ${daysFromNow(5)}, in observance of Presidents' Day.

This is a paid holiday for all full-time employees. If you're on-call, the standard on-call procedures apply.

Normal business hours resume Tuesday.

Enjoy the long weekend!

HR Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['friendly', 'neutral', 'professional', 'casual'],
    },
  },
  {
    id: 'AA4',
    name: 'IT maintenance window notification',
    scenario_category: 'internal',
    email: {
      sender: 'it-ops@company.com',
      subject: 'Scheduled maintenance: Internal tools downtime',
      body_text: `Dear team,

Our IT team will be performing scheduled maintenance on internal systems.

Maintenance window:
- Date: ${daysFromNow(3)} (Saturday)
- Time: 2:00 AM - 6:00 AM PST

Affected systems:
- Jira
- Confluence
- Internal CI/CD pipelines
- VPN

No action is required on your part. Systems will be restored automatically. If you experience issues after the maintenance window, contact it-support@company.com.

IT Operations`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false, // Informational date, not a deadline for the user
      meeting_expected: false,
      acceptable_tones: ['professional', 'neutral', 'informative', 'formal'],
    },
  },
  {
    id: 'AA5',
    name: 'Expense policy update with compliance deadline',
    scenario_category: 'internal',
    email: {
      sender: 'finance@company.com',
      subject: 'Updated expense policy - Action required by ' + daysFromNow(14),
      body_text: `Hi all,

We've updated our expense reimbursement policy effective immediately. Key changes:

1. Receipt required for all expenses over $25 (previously $50)
2. Meal expenses capped at $75/person for client dinners
3. All outstanding Q1 expenses must be submitted by ${daysFromNow(14)}
4. New expense tool: switch from Expensify to Ramp by ${daysFromNow(14)}

Please review the full policy at wiki.company.com/expense-policy and ensure all outstanding expenses are submitted before the deadline.

Questions? Contact finance@company.com.

Finance Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(14),
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'neutral', 'direct'],
    },
  },

  // ===== AB: SECURITY & ACCOUNT (4) =====
  {
    id: 'AB1',
    name: 'Password reset request (legitimate)',
    scenario_category: 'security',
    email: {
      sender: 'noreply@github.com',
      subject: '[GitHub] Password reset',
      body_text: `We heard that you lost your GitHub password. Sorry about that!

But don't worry! You can use the following link to reset your password:

https://github.com/password_reset/abc123def456

If you don't use this link within 3 hours, it will expire.

If you didn't request this, you can safely ignore this email.

Thanks,
The GitHub Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'friendly', 'casual', 'professional', 'automated'],
    },
  },
  {
    id: 'AB2',
    name: '2FA code email',
    scenario_category: 'security',
    email: {
      sender: 'noreply@accounts.google.com',
      subject: 'Your verification code: 847291',
      body_text: `847291

This is your verification code. It expires in 10 minutes.

If you didn't request this code, someone may be trying to access your account. We recommend changing your password.

Google Accounts Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Low',
      acceptable_categories: ['Normal'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'automated', 'formal'],
    },
  },
  {
    id: 'AB3',
    name: 'Suspicious login alert (real, not phishing)',
    scenario_category: 'security',
    email: {
      sender: 'noreply@accounts.google.com',
      subject: 'Security alert: New sign-in from Windows',
      body_text: `New sign-in to your Google Account

We noticed a new sign-in to your Google Account.

Device: Windows Desktop
Location: Chicago, IL, USA
Time: ${daysFromNow(0)}, 3:42 AM PST
IP: 198.51.100.42

If this was you, you can safely ignore this email.

If this wasn't you, your account may be compromised. Secure your account now:
https://myaccount.google.com/security

Google Security Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal', 'Urgent'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: false,
      meeting_expected: false,
      acceptable_tones: ['neutral', 'professional', 'formal', 'cautious', 'concerned', 'automated'],
    },
  },
  {
    id: 'AB4',
    name: 'Data breach notification with action deadline',
    scenario_category: 'security',
    email: {
      sender: 'security@service.com',
      subject: 'Important: Security incident notification',
      body_text: `Dear Valued Customer,

We are writing to inform you of a security incident that may have affected your account.

What happened: On ${daysFromNow(-14)}, we discovered unauthorized access to a database containing customer email addresses and hashed passwords.

What we're doing: We've secured the affected systems, engaged a cybersecurity firm, and notified law enforcement.

What you should do:
1. Change your password immediately
2. Enable two-factor authentication
3. If you used the same password elsewhere, change those too

We are offering 12 months of free credit monitoring. To enroll, visit service.com/security-incident and sign up before ${daysFromNow(30)}.

We sincerely apologize for this incident.

Service Security Team`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(30),
      meeting_expected: false,
      acceptable_tones: ['professional', 'formal', 'serious', 'apologetic', 'concerned', 'neutral'],
    },
  },

  // ===== AC: COMPLEX MULTI-CONTEXT (5) =====
  {
    id: 'AC1',
    name: 'Email with both a meeting AND a separate deadline',
    scenario_category: 'complex',
    email: {
      sender: 'pm@company.com',
      subject: 'Sprint planning + spec review deadline',
      body_text: `Hi,

Two things:

1. Sprint Planning Meeting: ${daysFromNow(3)} at 10:00 AM in Conference Room A. Please come with your capacity estimates.

2. The product spec for the new onboarding flow needs your final review and sign-off by ${daysFromNow(5)}. Marketing is waiting on this to begin their launch prep.

Let me know if you have questions on either.

Thanks,
PM`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Urgent', 'Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: true,
      event_type: 'meeting',
      acceptable_tones: ['professional', 'neutral', 'direct', 'friendly'],
      min_questions: 1,
      max_questions: 3,
    },
  },
  {
    id: 'AC2',
    name: 'Email with 3+ questions requiring different answer types',
    scenario_category: 'complex',
    email: {
      sender: 'newdev@company.com',
      subject: 'Onboarding questions - need your help!',
      body_text: `Hi!

I just joined the team and have a few questions as I ramp up:

1. What's the preferred code review turnaround time? (hours? days?)
2. Can I get access to the staging environment? Who do I contact for that?
3. I noticed the README mentions a "feature flag service" — is that still in use or deprecated?
4. Would you be open to a quick pairing session this week to walk me through the deployment pipeline?
5. Where does the team usually go for lunch?

Sorry for all the questions! Just trying to get up to speed.

Thanks!
Jordan`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: false,
      meeting_expected: true, // "pairing session this week" is a meeting request
      event_type: 'meeting',
      acceptable_tones: ['friendly', 'enthusiastic', 'casual', 'eager'],
      min_questions: 3,
      max_questions: 6,
    },
  },
  {
    id: 'AC3',
    name: 'Forwarded chain where only top message matters',
    scenario_category: 'complex',
    email: {
      sender: 'director@company.com',
      subject: 'Fwd: Fwd: Re: Re: Budget approval chain',
      body_text: `Approved. Go ahead and place the order.

---------- Forwarded message ----------
From: vp@company.com
Date: ${daysFromNow(-1)}

Looks good to me. Just need director sign-off.

---------- Forwarded message ----------
From: manager@company.com
Date: ${daysFromNow(-3)}

Hi all,

We need to order 10 new developer workstations. Total cost: $25,000.

Vendor: TechDirect
Quote valid until: ${daysFromNow(10)}
Delivery: 5-7 business days after order

Please approve so we can proceed.

Thanks,
Manager`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false, // Already approved — action on you to place the order, not reply
      deadline_expected: true,
      deadline_date_approx: daysFromNow(10), // Quote validity is the relevant deadline
      meeting_expected: false,
      acceptable_tones: ['professional', 'direct', 'neutral', 'brief', 'casual'],
    },
  },
  {
    id: 'AC4',
    name: 'Action items for multiple people, only some for you',
    scenario_category: 'complex',
    email: {
      sender: 'teamlead@company.com',
      subject: 'Action items from product sync',
      body_text: `Team,

Here are the action items from today's product sync:

@Alice - Update the pricing page copy by ${daysFromNow(3)}
@Bob - Fix the checkout flow bug (JIRA-4521) by ${daysFromNow(2)}
@You - Review and approve Bob's PR once it's up
@Charlie - Send the updated API docs to the partner team
@You - Schedule a meeting with the design team re: mobile redesign by ${daysFromNow(5)}

Let me know if anyone has bandwidth issues.

Thanks,
Team Lead`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Normal',
      acceptable_categories: ['Important'],
      requires_reply: false,
    },
    expected_analysis: {
      requires_reply: false,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: false, // "Schedule a meeting" is a task, not a detected upcoming meeting
      acceptable_tones: ['professional', 'direct', 'neutral'],
    },
  },
  {
    id: 'AC5',
    name: 'Reply-all thread with direct question to you mid-chain',
    scenario_category: 'complex',
    email: {
      sender: 'architect@company.com',
      subject: 'Re: Re: Architecture decision - cache strategy',
      body_text: `Replying all —

I've reviewed everyone's input and here's where we stand:

- Redis cluster: @DevOps gave thumbs up on infra
- CDN caching: @Frontend confirmed it works with their setup
- @You: Can you run a load test on the Redis cluster this week? We need the numbers before the architecture review on ${daysFromNow(5)}.

If the load test results look good, I'll finalize the ADR and send it to the team by end of week.

Everyone else: please hold off on implementing any caching changes until the ADR is published.

— Systems Architect`,
      has_attachments: false,
    },
    expected_classification: {
      category: 'Important',
      acceptable_categories: ['Normal'],
      requires_reply: true,
    },
    expected_analysis: {
      requires_reply: true,
      deadline_expected: true,
      deadline_date_approx: daysFromNow(5),
      meeting_expected: false,
      acceptable_tones: ['professional', 'direct', 'neutral', 'technical'],
      min_questions: 1,
      max_questions: 3,
    },
  },
];

// Quick smoke test subset (5 diverse cases)
export const QUICK_TEST_IDS = ['A1', 'C3', 'E1', 'G3', 'J1'];

// Edge case subset for testing new scenarios
export const EDGE_CASE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'];

// New test case subsets
export const DEADLINE_DISPLAY_IDS = ['N1', 'N2', 'N3', 'N4'];
export const CRM_IDS = ['O1', 'O2', 'O3'];
export const LIFE_INTEL_IDS = ['P1', 'P2', 'P3', 'P4'];
export const CROSS_DIMENSION_IDS = ['Q1', 'Q2', 'Q3', 'Q4'];
export const ECOMMERCE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5'];
export const HEALTHCARE_IDS = ['S1', 'S2', 'S3', 'S4'];
export const GOVERNMENT_IDS = ['T1', 'T2', 'T3', 'T4'];
export const CAREER_IDS = ['U1', 'U2', 'U3', 'U4'];
export const PERSONAL_IDS = ['V1', 'V2', 'V3', 'V4', 'V5'];
export const SCHEDULING_IDS = ['W1', 'W2', 'W3', 'W4'];
export const SUPPORT_IDS = ['X1', 'X2', 'X3', 'X4'];
export const VENDOR_IDS = ['Y1', 'Y2', 'Y3', 'Y4'];
export const AMBIGUOUS_IDS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];
export const INTERNAL_IDS = ['AA1', 'AA2', 'AA3', 'AA4', 'AA5'];
export const SECURITY_IDS = ['AB1', 'AB2', 'AB3', 'AB4'];
export const COMPLEX_IDS = ['AC1', 'AC2', 'AC3', 'AC4', 'AC5'];
