/**
 * OPS Web - TaskType Service
 *
 * Complete CRUD operations for TaskTypes.
 * CRITICAL: TaskType DTO can return "id" or "_id", and "display" or "Display".
 * The DTO layer handles normalization.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleTaskTypeFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type TaskTypeDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  taskTypeDtoToModel,
  taskTypeModelToDto,
} from "../../types/dto";
import type { TaskType } from "../../types/models";

// ─── TaskType Service ─────────────────────────────────────────────────────────

export const TaskTypeService = {
  /**
   * Fetch all task types for a company.
   */
  async fetchTaskTypes(companyId: string): Promise<TaskType[]> {
    const client = getBubbleClient();

    // TaskType doesn't have a direct company field in BubbleFields,
    // but the API returns them filtered by company context.
    // We fetch all and let the caller filter if needed.
    const constraints: BubbleConstraint[] = [
      {
        key: BubbleTaskTypeFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    const params = {
      constraints: JSON.stringify(constraints),
      limit: 100,
      cursor: 0,
    };

    const response = await client.get<BubbleListResponse<TaskTypeDTO>>(
      `/obj/${BubbleTypes.taskType.toLowerCase()}`,
      { params }
    );

    return response.response.results.map((dto) => {
      const model = taskTypeDtoToModel(dto);
      model.companyId = companyId;
      return model;
    });
  },

  /**
   * Fetch a single task type by ID.
   */
  async fetchTaskType(id: string): Promise<TaskType> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<TaskTypeDTO>>(
      `/obj/${BubbleTypes.taskType.toLowerCase()}/${id}`
    );

    return taskTypeDtoToModel(response.response);
  },

  /**
   * Create a new task type.
   */
  async createTaskType(
    data: Partial<TaskType> & { display: string; color: string }
  ): Promise<string> {
    const client = getBubbleClient();

    const dto = taskTypeModelToDto(data);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.taskType.toLowerCase()}`,
      dto
    );

    return response.id;
  },

  /**
   * Update an existing task type.
   */
  async updateTaskType(
    id: string,
    data: Partial<TaskType>
  ): Promise<void> {
    const client = getBubbleClient();

    const dto = taskTypeModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.taskType.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Soft delete a task type.
   */
  async deleteTaskType(id: string): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.taskType.toLowerCase()}/${id}`,
      { [BubbleTaskTypeFields.deletedAt]: new Date().toISOString() }
    );
  },

  /**
   * Create default task types for a new company.
   * Returns array of created IDs.
   */
  async createDefaultTaskTypes(companyId: string): Promise<string[]> {
    const defaults = [
      { display: "Quote", color: "#B5A381", isDefault: true },
      { display: "Installation", color: "#8195B5", isDefault: true },
      { display: "Repair", color: "#B58289", isDefault: true },
      { display: "Inspection", color: "#9DB582", isDefault: true },
      { display: "Consultation", color: "#A182B5", isDefault: true },
      { display: "Follow-up", color: "#C4A868", isDefault: true },
    ];

    const ids: string[] = [];

    for (const taskType of defaults) {
      const id = await TaskTypeService.createTaskType({
        ...taskType,
        companyId,
      });
      ids.push(id);
    }

    return ids;
  },
};

export default TaskTypeService;
