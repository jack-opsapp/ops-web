/**
 * Mock Data Factory
 *
 * Provides realistic test data matching exact Bubble.io field names and formats.
 * All factory functions accept optional overrides to customize individual fields.
 */

// ─── Type Definitions (matching Bubble DTOs) ────────────────────────────────

export interface ProjectDTO {
  _id: string;
  projectName: string;
  address: string;
  client: string;
  clientName: string;
  company: string;
  status: string;
  startDate: string;
  completion: number;
  description: string;
  teamNotes: string;
  tasks: string[];
  calendarEvent: string[];
  projectImages: string[];
  allDay: boolean;
  duration: number;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface TaskDTO {
  _id: string;
  calendarEventId: string;
  companyId: string;
  completionDate: string | null;
  projectId: string;
  scheduledDate: string;
  status: string;
  taskColor: string;
  taskIndex: number;
  taskNotes: string;
  teamMembers: string[];
  type: string;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface CalendarEventDTO {
  _id: string;
  color: string;
  companyId: string;
  duration: number;
  endDate: string;
  projectId: string;
  startDate: string;
  taskId: string;
  teamMembers: string[];
  title: string;
  eventType: string;
  active: boolean;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface ClientDTO {
  _id: string;
  name: string;
  emailAddress: string;
  phoneNumber: string;
  address: string;
  parentCompany: string;
  subClients: string[];
  projectsList: string[];
  status: string;
  balance: number;
  clientIdNo: string;
  estimates: string[];
  invoices: string[];
  isCompany: boolean;
  avatar: string;
  unit: string;
  userId: string;
  notes: string;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface SubClientDTO {
  _id: string;
  name: string;
  emailAddress: string;
  phoneNumber: string | number;
  address: string;
  parentClient: string;
  title: string;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface UserDTO {
  _id: string;
  nameFirst: string;
  nameLast: string;
  email: string;
  phone: string;
  company: string;
  employeeType: string;
  userType: string;
  avatar: string;
  profileImageURL: string;
  currentLocation: string;
  homeAddress: string;
  clientId: string;
  deviceToken: string;
  hasCompletedAppTutorial: boolean;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface CompanyDTO {
  _id: string;
  companyName: string;
  companyId: string;
  location: string;
  logo: string;
  logoURL: string;
  defaultProjectColor: string;
  projects: string[];
  teams: string[];
  clients: string[];
  taskTypes: string[];
  calendarEventsList: string[];
  admin: string[];
  seatedEmployees: string[];
  subscriptionStatus: string;
  subscriptionPlan: string;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface TaskTypeDTO {
  _id: string;
  color: string;
  display: string;
  isDefault: boolean;
  deletedAt: string | null;
  Created_Date: string;
  Modified_Date: string;
}

export interface TeamMemberDTO {
  _id: string;
  nameFirst: string;
  nameLast: string;
  email: string;
  phone: string;
  employeeType: string;
  profileImageURL: string;
  company: string;
}

// ─── ID Generators ──────────────────────────────────────────────────────────

let idCounter = 0;

function generateId(prefix = ""): string {
  idCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}${timestamp}${random}${idCounter}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

// ─── Date Helpers ───────────────────────────────────────────────────────────

function isoDate(daysFromNow = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
}

function pastDate(daysAgo: number): string {
  return isoDate(-daysAgo);
}

function futureDate(daysAhead: number): string {
  return isoDate(daysAhead);
}

// ─── Individual Mock Factories ──────────────────────────────────────────────

export function mockProject(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    _id: generateId("proj_"),
    projectName: "Kitchen Renovation - Smith Residence",
    address: "1425 Oak Valley Dr, Austin, TX 78745",
    client: generateId("cli_"),
    clientName: "John Smith",
    company: generateId("comp_"),
    status: "In Progress",
    startDate: pastDate(7),
    completion: 45,
    description: "Full kitchen remodel including countertops, cabinets, and backsplash tile installation.",
    teamNotes: "Access through side gate. Homeowner prefers morning work hours (8am-12pm).",
    tasks: [generateId("task_"), generateId("task_")],
    calendarEvent: [generateId("cal_")],
    projectImages: [],
    allDay: true,
    duration: 14,
    deletedAt: null,
    Created_Date: pastDate(14),
    Modified_Date: pastDate(1),
    ...overrides,
  };
}

export function mockTask(overrides: Partial<TaskDTO> = {}): TaskDTO {
  return {
    _id: generateId("task_"),
    calendarEventId: generateId("cal_"),
    companyId: generateId("comp_"),
    completionDate: null,
    projectId: generateId("proj_"),
    scheduledDate: futureDate(3),
    status: "Booked",
    taskColor: "#417394",
    taskIndex: 0,
    taskNotes: "Bring extra 2x4 lumber for framing adjustments.",
    teamMembers: [generateId("user_"), generateId("user_")],
    type: generateId("tt_"),
    deletedAt: null,
    Created_Date: pastDate(5),
    Modified_Date: pastDate(1),
    ...overrides,
  };
}

export function mockCalendarEvent(
  overrides: Partial<CalendarEventDTO> = {}
): CalendarEventDTO {
  const start = futureDate(2);
  const end = futureDate(3);
  return {
    _id: generateId("cal_"),
    color: "#417394",
    companyId: generateId("comp_"),
    duration: 1,
    endDate: end,
    projectId: generateId("proj_"),
    startDate: start,
    taskId: generateId("task_"),
    teamMembers: [generateId("user_")],
    title: "Cabinet Installation",
    eventType: "task",
    active: true,
    deletedAt: null,
    Created_Date: pastDate(3),
    Modified_Date: pastDate(1),
    ...overrides,
  };
}

export function mockClient(overrides: Partial<ClientDTO> = {}): ClientDTO {
  return {
    _id: generateId("cli_"),
    name: "Horizon Properties LLC",
    emailAddress: "contact@horizonproperties.com",
    phoneNumber: "(512) 555-0142",
    address: "8900 Research Blvd, Suite 200, Austin, TX 78758",
    parentCompany: generateId("comp_"),
    subClients: [],
    projectsList: [generateId("proj_")],
    status: "Active",
    balance: 12500.0,
    clientIdNo: "CL-2024-0089",
    estimates: [],
    invoices: [],
    isCompany: true,
    avatar: "",
    unit: "",
    userId: generateId("user_"),
    notes: "Premium client. Manages 15 rental properties in central Austin area.",
    deletedAt: null,
    Created_Date: pastDate(90),
    Modified_Date: pastDate(2),
    ...overrides,
  };
}

export function mockSubClient(
  overrides: Partial<SubClientDTO> = {}
): SubClientDTO {
  return {
    _id: generateId("sub_"),
    name: "Sarah Martinez",
    emailAddress: "s.martinez@horizonproperties.com",
    phoneNumber: "(512) 555-0198",
    address: "1200 Congress Ave, Austin, TX 78701",
    parentClient: generateId("cli_"),
    title: "Property Manager",
    deletedAt: null,
    Created_Date: pastDate(60),
    Modified_Date: pastDate(5),
    ...overrides,
  };
}

export function mockUser(overrides: Partial<UserDTO> = {}): UserDTO {
  return {
    _id: generateId("user_"),
    nameFirst: "Marcus",
    nameLast: "Johnson",
    email: "marcus.johnson@opsapp.co",
    phone: "(512) 555-0234",
    company: generateId("comp_"),
    employeeType: "Field Crew",
    userType: "Employee",
    avatar: "",
    profileImageURL: "https://storage.googleapis.com/ops-avatars/user-placeholder.png",
    currentLocation: "30.2672,-97.7431",
    homeAddress: "3450 Riverside Dr, Austin, TX 78741",
    clientId: "",
    deviceToken: "dGVzdC1kZXZpY2UtdG9rZW4tMTIzNDU2",
    hasCompletedAppTutorial: true,
    deletedAt: null,
    Created_Date: pastDate(180),
    Modified_Date: pastDate(1),
    ...overrides,
  };
}

export function mockCompany(overrides: Partial<CompanyDTO> = {}): CompanyDTO {
  const companyId = overrides._id || generateId("comp_");
  return {
    _id: companyId,
    companyName: "Lone Star Renovations",
    companyId: "LSR-2024",
    location: "Austin, TX",
    logo: "https://storage.googleapis.com/ops-logos/lsr-logo.png",
    logoURL: "https://storage.googleapis.com/ops-logos/lsr-logo.png",
    defaultProjectColor: "#9CA3AF",
    projects: [generateId("proj_"), generateId("proj_"), generateId("proj_")],
    teams: [generateId("user_"), generateId("user_"), generateId("user_")],
    clients: [generateId("cli_"), generateId("cli_")],
    taskTypes: [generateId("tt_"), generateId("tt_"), generateId("tt_")],
    calendarEventsList: [generateId("cal_"), generateId("cal_")],
    admin: [generateId("user_")],
    seatedEmployees: [generateId("user_"), generateId("user_"), generateId("user_")],
    subscriptionStatus: "active",
    subscriptionPlan: "team",
    deletedAt: null,
    Created_Date: pastDate(365),
    Modified_Date: pastDate(1),
    ...overrides,
  };
}

export function mockTaskType(
  overrides: Partial<TaskTypeDTO> = {}
): TaskTypeDTO {
  return {
    _id: generateId("tt_"),
    color: "#C4A868",
    display: "Installation",
    isDefault: true,
    deletedAt: null,
    Created_Date: pastDate(180),
    Modified_Date: pastDate(30),
    ...overrides,
  };
}

export function mockTeamMember(
  overrides: Partial<TeamMemberDTO> = {}
): TeamMemberDTO {
  return {
    _id: generateId("user_"),
    nameFirst: "Carlos",
    nameLast: "Rivera",
    email: "carlos.rivera@opsapp.co",
    phone: "(512) 555-0367",
    employeeType: "Field Crew",
    profileImageURL: "https://storage.googleapis.com/ops-avatars/carlos-r.png",
    company: generateId("comp_"),
    ...overrides,
  };
}

// ─── Collection Factories ───────────────────────────────────────────────────

export function mockProjects(count: number): ProjectDTO[] {
  const projectNames = [
    "Kitchen Renovation - Smith Residence",
    "Bathroom Remodel - Johnson Home",
    "Deck Construction - 1842 Elm St",
    "Roof Repair - Westlake Office",
    "Flooring Install - Downtown Loft",
    "HVAC Replacement - Martinez Property",
    "Window Install - Lakeside Condo",
    "Fence Repair - Mueller Community",
    "Painting - Corporate Office Suite",
    "Plumbing Overhaul - Restaurant Row",
  ];
  const statuses = ["RFQ", "Estimated", "Accepted", "In Progress", "Completed", "Closed"];
  const addresses = [
    "1425 Oak Valley Dr, Austin, TX 78745",
    "2810 South Lamar Blvd, Austin, TX 78704",
    "5500 N MoPac Expy, Austin, TX 78731",
    "901 W Riverside Dr, Austin, TX 78704",
    "1100 Congress Ave, Austin, TX 78701",
    "3200 Bee Cave Rd, Austin, TX 78746",
    "7700 Gateway Blvd, Austin, TX 78735",
    "4200 Mueller Blvd, Austin, TX 78723",
    "500 E 4th St, Austin, TX 78701",
    "2300 S Pleasant Valley Rd, Austin, TX 78741",
  ];

  return Array.from({ length: count }, (_, i) => {
    const idx = i % projectNames.length;
    return mockProject({
      projectName: projectNames[idx],
      address: addresses[idx],
      status: statuses[i % statuses.length],
      completion: Math.floor((i / count) * 100),
      startDate: pastDate(count - i),
    });
  });
}

export function mockTasks(count: number): TaskDTO[] {
  const statuses = ["Booked", "In Progress", "Completed", "Cancelled"];
  const colors = ["#417394", "#C4A868", "#93321A", "#4CAF50", "#FF9800", "#9C27B0"];
  const notes = [
    "Bring extra materials for potential adjustments.",
    "Client will be on-site to supervise.",
    "Access code: 4521. Ring doorbell on arrival.",
    "Park in designated contractor spots only.",
    "Coordinate with electrician arriving at 10am.",
    "Weather permitting - reschedule if rain.",
  ];

  return Array.from({ length: count }, (_, i) => {
    return mockTask({
      status: statuses[i % statuses.length],
      taskColor: colors[i % colors.length],
      taskNotes: notes[i % notes.length],
      taskIndex: i,
      scheduledDate: futureDate(i + 1),
    });
  });
}

export function mockCalendarEvents(count: number): CalendarEventDTO[] {
  const titles = [
    "Cabinet Installation",
    "Plumbing Rough-In",
    "Electrical Wiring",
    "Drywall Hanging",
    "Tile Setting",
    "Paint Prep & Prime",
    "Final Inspection",
    "Demolition Day",
  ];

  return Array.from({ length: count }, (_, i) => {
    return mockCalendarEvent({
      title: titles[i % titles.length],
      startDate: futureDate(i),
      endDate: futureDate(i + 1),
      duration: 1,
    });
  });
}

export function mockClients(count: number): ClientDTO[] {
  const names = [
    "Horizon Properties LLC",
    "Sunbelt Commercial Group",
    "Margaret Chen",
    "David & Lisa Thompson",
    "Oakwood HOA",
    "Bluebonnet Realty",
    "River City Developments",
    "James Patterson",
  ];
  const emails = [
    "contact@horizonproperties.com",
    "info@sunbeltcommercial.com",
    "m.chen@gmail.com",
    "thompson.family@yahoo.com",
    "board@oakwoodhoa.org",
    "leasing@bluebonnetrealty.com",
    "dev@rivercitydev.com",
    "j.patterson@outlook.com",
  ];

  return Array.from({ length: count }, (_, i) => {
    const idx = i % names.length;
    return mockClient({
      name: names[idx],
      emailAddress: emails[idx],
      isCompany: i % 3 === 0,
    });
  });
}

export function mockUsers(count: number): UserDTO[] {
  const firstNames = [
    "Marcus", "Elena", "James", "Sofia", "Derek",
    "Ana", "Ryan", "Priya", "Tyler", "Carmen",
  ];
  const lastNames = [
    "Johnson", "Garcia", "Williams", "Patel", "Anderson",
    "Martinez", "Thompson", "Singh", "Mitchell", "Rodriguez",
  ];
  const types = ["Field Crew", "Field Crew", "Office Crew", "Admin", "Field Crew"];

  return Array.from({ length: count }, (_, i) => {
    const fIdx = i % firstNames.length;
    const lIdx = i % lastNames.length;
    return mockUser({
      nameFirst: firstNames[fIdx],
      nameLast: lastNames[lIdx],
      email: `${firstNames[fIdx].toLowerCase()}.${lastNames[lIdx].toLowerCase()}@opsapp.co`,
      employeeType: types[i % types.length],
    });
  });
}

export function mockTaskTypes(count: number): TaskTypeDTO[] {
  const defaults = [
    { display: "Quote", color: "#C4A868" },
    { display: "Installation", color: "#417394" },
    { display: "Inspection", color: "#4CAF50" },
    { display: "Repair", color: "#FF9800" },
    { display: "Maintenance", color: "#9C27B0" },
    { display: "Demolition", color: "#93321A" },
  ];

  return Array.from({ length: count }, (_, i) => {
    const idx = i % defaults.length;
    return mockTaskType({
      display: defaults[idx].display,
      color: defaults[idx].color,
      isDefault: i < defaults.length,
    });
  });
}

// ─── Bubble API Response Wrappers ───────────────────────────────────────────

export interface BubbleListResponse<T> {
  response: {
    cursor: number;
    results: T[];
    remaining: number;
    count: number;
  };
}

export interface BubbleSingleResponse<T> {
  response: T;
}

export function wrapBubbleList<T>(results: T[], cursor = 0): BubbleListResponse<T> {
  return {
    response: {
      cursor,
      results,
      remaining: 0,
      count: results.length,
    },
  };
}

export function wrapBubbleSingle<T>(result: T): BubbleSingleResponse<T> {
  return {
    response: result,
  };
}

// ─── Pre-built Scenarios ────────────────────────────────────────────────────

/**
 * Creates a complete project scenario with related tasks, events, and client.
 */
export function mockProjectScenario() {
  const companyId = generateId("comp_");
  const clientId = generateId("cli_");
  const projectId = generateId("proj_");
  const taskTypeId = generateId("tt_");
  const userId1 = generateId("user_");
  const userId2 = generateId("user_");

  const task1Id = generateId("task_");
  const task2Id = generateId("task_");
  const cal1Id = generateId("cal_");
  const cal2Id = generateId("cal_");

  const company = mockCompany({ _id: companyId, admin: [userId1] });
  const client = mockClient({ _id: clientId, parentCompany: companyId });
  const taskType = mockTaskType({ _id: taskTypeId });

  const project = mockProject({
    _id: projectId,
    company: companyId,
    client: clientId,
    clientName: client.name,
    tasks: [task1Id, task2Id],
    calendarEvent: [cal1Id, cal2Id],
  });

  const task1 = mockTask({
    _id: task1Id,
    projectId,
    companyId,
    calendarEventId: cal1Id,
    type: taskTypeId,
    teamMembers: [userId1, userId2],
    status: "Booked",
    taskIndex: 0,
  });

  const task2 = mockTask({
    _id: task2Id,
    projectId,
    companyId,
    calendarEventId: cal2Id,
    type: taskTypeId,
    teamMembers: [userId1],
    status: "In Progress",
    taskIndex: 1,
  });

  const event1 = mockCalendarEvent({
    _id: cal1Id,
    projectId,
    companyId,
    taskId: task1Id,
    teamMembers: [userId1, userId2],
  });

  const event2 = mockCalendarEvent({
    _id: cal2Id,
    projectId,
    companyId,
    taskId: task2Id,
    teamMembers: [userId1],
  });

  const user1 = mockUser({
    _id: userId1,
    company: companyId,
    employeeType: "Admin",
  });

  const user2 = mockUser({
    _id: userId2,
    company: companyId,
    nameFirst: "Elena",
    nameLast: "Garcia",
    email: "elena.garcia@opsapp.co",
  });

  return {
    company,
    client,
    project,
    tasks: [task1, task2],
    events: [event1, event2],
    users: [user1, user2],
    taskType,
  };
}
