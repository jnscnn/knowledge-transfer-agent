// Analyze calendar patterns for the Passive Observer module

import { logger } from '../shared/logger.js';
import type { GraphApiClient, GraphEvent } from './graph-client.js';

export interface CalendarAnalysis {
  recurringMeetings: Array<{
    subject: string;
    frequency: string;
    attendees: string[];
    isOrganizer: boolean;
  }>;
  meetingCategories: Record<string, number>;
  uniqueAttendees: string[];
  timeAllocation: Record<string, number>;
}

export class CalendarAnalyzer {
  private graphClient: GraphApiClient;

  constructor(graphClient: GraphApiClient) {
    this.graphClient = graphClient;
  }

  async analyzePatterns(retireeId: string, periodDays = 90): Promise<CalendarAnalysis> {
    logger.info('Analyzing calendar patterns', {
      component: 'CalendarAnalyzer',
      operation: 'analyzePatterns',
      retireeId,
      periodDays: String(periodDays),
    });

    const start = new Date();
    start.setDate(start.getDate() - periodDays);
    const end = new Date();

    const [calendarEvents, recurringEvents] = await Promise.all([
      this.graphClient.getCalendarView(retireeId, start, end),
      this.graphClient.getRecurringEvents(retireeId),
    ]);

    const recurringMeetings = this.analyzeRecurring(recurringEvents, retireeId);
    const meetingCategories = this.categorizeMeetings(calendarEvents);
    const uniqueAttendees = this.findUniqueAttendees(calendarEvents);
    const timeAllocation = this.computeTimeAllocation(calendarEvents);

    logger.info('Calendar analysis complete', {
      component: 'CalendarAnalyzer',
      retireeId,
      eventCount: String(calendarEvents.length),
      recurringCount: String(recurringMeetings.length),
    });

    return { recurringMeetings, meetingCategories, uniqueAttendees, timeAllocation };
  }

  private analyzeRecurring(
    events: GraphEvent[],
    retireeId: string,
  ): CalendarAnalysis['recurringMeetings'] {
    return events.map((event) => ({
      subject: event.subject,
      frequency: this.describeRecurrence(event.recurrence),
      attendees: event.attendees,
      isOrganizer: event.organizer === retireeId,
    }));
  }

  private describeRecurrence(recurrence: unknown): string {
    if (!recurrence || typeof recurrence !== 'object') return 'unknown';
    const rec = recurrence as Record<string, unknown>;
    const pattern = rec['pattern'] as Record<string, unknown> | undefined;
    if (!pattern) return 'unknown';

    const type = String(pattern['type'] ?? 'unknown');
    const interval = Number(pattern['interval'] ?? 1);

    switch (type) {
      case 'daily':
        return interval === 1 ? 'daily' : `every ${interval} days`;
      case 'weekly':
        return interval === 1 ? 'weekly' : `every ${interval} weeks`;
      case 'absoluteMonthly':
      case 'relativeMonthly':
        return interval === 1 ? 'monthly' : `every ${interval} months`;
      case 'absoluteYearly':
      case 'relativeYearly':
        return 'yearly';
      default:
        return type;
    }
  }

  private categorizeMeetings(events: GraphEvent[]): Record<string, number> {
    const categories: Record<string, number> = {};

    for (const event of events) {
      const category = this.inferCategory(event);
      categories[category] = (categories[category] ?? 0) + 1;
    }

    return categories;
  }

  private inferCategory(event: GraphEvent): string {
    const subject = event.subject.toLowerCase();
    if (subject.includes('standup') || subject.includes('stand-up') || subject.includes('scrum')) {
      return 'standup';
    }
    if (subject.includes('1:1') || subject.includes('1-1') || subject.includes('one on one')) {
      return '1:1';
    }
    if (subject.includes('review') || subject.includes('retro')) {
      return 'review';
    }
    if (subject.includes('planning') || subject.includes('sprint')) {
      return 'planning';
    }
    if (subject.includes('training') || subject.includes('onboard')) {
      return 'training';
    }
    if (event.isOnlineMeeting && event.attendees.length > 10) {
      return 'large-meeting';
    }
    return 'other';
  }

  private findUniqueAttendees(events: GraphEvent[]): string[] {
    const attendeeSet = new Set<string>();
    for (const event of events) {
      for (const attendee of event.attendees) {
        if (attendee) attendeeSet.add(attendee);
      }
    }
    return Array.from(attendeeSet);
  }

  private computeTimeAllocation(events: GraphEvent[]): Record<string, number> {
    const allocation: Record<string, number> = {};

    for (const event of events) {
      const category = this.inferCategory(event);
      const durationMs = event.end.getTime() - event.start.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);
      allocation[category] = (allocation[category] ?? 0) + durationHours;
    }

    // Round to 1 decimal
    for (const key of Object.keys(allocation)) {
      allocation[key] = Math.round(allocation[key]! * 10) / 10;
    }

    return allocation;
  }
}
