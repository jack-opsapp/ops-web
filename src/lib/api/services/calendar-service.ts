/**
 * OPS Web - Calendar Event Service
 *
 * Complete CRUD operations for CalendarEvents.
 * Note: CalendarEvent API type is lowercase "calendarevent" in Bubble.
 * All queries filter out soft-deleted items.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleCalendarEventFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type CalendarEventDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  calendarEventDtoToModel,
  calendarEventModelToDto,
} from "../../types/dto";
import type { CalendarEvent } from "../../types/models";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchCalendarEventsOptions {
  /** Filter by project ID */
  projectId?: string;
  /** Filter by task ID */
  taskId?: string;
  /** Filter events starting on or after this date */
  startDateFrom?: Date;
  /** Filter events starting on or before this date */
  startDateTo?: Date;
  /** Filter events ending on or after this date */
  endDateFrom?: Date;
  /** Filter by team member */
  teamMemberId?: string;
  /** Sort field */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit */
  limit?: number;
  /** Pagination cursor */
  cursor?: number;
}

// ─── Calendar Event Service ───────────────────────────────────────────────────

export const CalendarService = {
  /**
   * Fetch calendar events for a company with optional filters.
   */
  async fetchCalendarEvents(
    companyId: string,
    options: FetchCalendarEventsOptions = {}
  ): Promise<{
    events: CalendarEvent[];
    remaining: number;
    count: number;
  }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleCalendarEventFields.companyId,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleCalendarEventFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.projectId) {
      constraints.push({
        key: BubbleCalendarEventFields.projectId,
        constraint_type: BubbleConstraintType.equals,
        value: options.projectId,
      });
    }

    if (options.taskId) {
      constraints.push({
        key: BubbleCalendarEventFields.taskId,
        constraint_type: BubbleConstraintType.equals,
        value: options.taskId,
      });
    }

    if (options.startDateFrom) {
      constraints.push({
        key: BubbleCalendarEventFields.startDate,
        constraint_type: BubbleConstraintType.greaterThan,
        value: options.startDateFrom.toISOString(),
      });
    }

    if (options.startDateTo) {
      constraints.push({
        key: BubbleCalendarEventFields.startDate,
        constraint_type: BubbleConstraintType.lessThan,
        value: options.startDateTo.toISOString(),
      });
    }

    if (options.endDateFrom) {
      constraints.push({
        key: BubbleCalendarEventFields.endDate,
        constraint_type: BubbleConstraintType.greaterThan,
        value: options.endDateFrom.toISOString(),
      });
    }

    if (options.teamMemberId) {
      constraints.push({
        key: BubbleCalendarEventFields.teamMembers,
        constraint_type: BubbleConstraintType.contains,
        value: options.teamMemberId,
      });
    }

    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
    };

    if (options.sortField) {
      params.sort_field = options.sortField;
      params.descending = options.descending ? "true" : "false";
    } else {
      // Default sort by start date ascending
      params.sort_field = BubbleCalendarEventFields.startDate;
      params.descending = "false";
    }

    // Note: BubbleTypes.calendarEvent is already lowercase "calendarevent"
    const response = await client.get<BubbleListResponse<CalendarEventDTO>>(
      `/obj/${BubbleTypes.calendarEvent}`,
      { params }
    );

    const events = response.response.results
      .map(calendarEventDtoToModel)
      .filter((e): e is CalendarEvent => e !== null);

    return {
      events,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch calendar events for a specific date range.
   * Commonly used for calendar view rendering.
   */
  async fetchEventsForDateRange(
    companyId: string,
    startDate: Date,
    endDate: Date,
    options: Omit<
      FetchCalendarEventsOptions,
      "startDateFrom" | "startDateTo"
    > = {}
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await CalendarService.fetchCalendarEvents(companyId, {
        ...options,
        startDateFrom: startDate,
        startDateTo: endDate,
        limit: 100,
        cursor,
      });

      allEvents.push(...result.events);
      remaining = result.remaining;
      cursor += result.events.length;
    }

    return allEvents;
  },

  /**
   * Fetch a single calendar event by ID.
   */
  async fetchCalendarEvent(id: string): Promise<CalendarEvent | null> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<CalendarEventDTO>>(
      `/obj/${BubbleTypes.calendarEvent}/${id}`
    );

    return calendarEventDtoToModel(response.response);
  },

  /**
   * Create a new calendar event.
   */
  async createCalendarEvent(
    data: Partial<CalendarEvent> & {
      projectId: string;
      companyId: string;
      title: string;
    }
  ): Promise<string> {
    const client = getBubbleClient();

    const dto = calendarEventModelToDto(data);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.calendarEvent}`,
      dto
    );

    return response.id;
  },

  /**
   * Update an existing calendar event.
   */
  async updateCalendarEvent(
    id: string,
    data: Partial<CalendarEvent>
  ): Promise<void> {
    const client = getBubbleClient();

    const dto = calendarEventModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.calendarEvent}/${id}`,
      dto
    );
  },

  /**
   * Soft delete a calendar event.
   */
  async deleteCalendarEvent(id: string): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.calendarEvent}/${id}`,
      { [BubbleCalendarEventFields.deletedAt]: new Date().toISOString() }
    );
  },

  /**
   * Fetch all calendar events with auto-pagination.
   */
  async fetchAllCalendarEvents(
    companyId: string,
    options: Omit<FetchCalendarEventsOptions, "limit" | "cursor"> = {}
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await CalendarService.fetchCalendarEvents(companyId, {
        ...options,
        limit: 100,
        cursor,
      });

      allEvents.push(...result.events);
      remaining = result.remaining;
      cursor += result.events.length;
    }

    return allEvents;
  },
};

export default CalendarService;
