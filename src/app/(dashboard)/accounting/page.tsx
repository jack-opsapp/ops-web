"use client";

import { useState, useMemo } from "react";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  PieChart,
  BarChart3,
  Clock,
  Building2,
  Wrench,
  Truck,
  Users,
  Zap,
  ShieldCheck,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MonthlyData {
  month: string;
  shortMonth: string;
  revenue: number;
  expenses: number;
}

interface ExpenseCategory {
  name: string;
  amount: number;
  percentage: number;
  color: string;
  icon: React.ReactNode;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: "income" | "expense";
  status: "completed" | "pending";
  client?: string;
  project?: string;
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------
const monthlyData: MonthlyData[] = [
  { month: "September", shortMonth: "Sep", revenue: 42000, expenses: 28500 },
  { month: "October", shortMonth: "Oct", revenue: 55000, expenses: 31200 },
  { month: "November", shortMonth: "Nov", revenue: 48000, expenses: 29800 },
  { month: "December", shortMonth: "Dec", revenue: 38000, expenses: 26400 },
  { month: "January", shortMonth: "Jan", revenue: 52000, expenses: 33100 },
  { month: "February", shortMonth: "Feb", revenue: 61000, expenses: 35600 },
];

const expenseCategories: ExpenseCategory[] = [
  {
    name: "Materials",
    amount: 14200,
    percentage: 39.9,
    color: "#417394",
    icon: <Wrench className="w-[14px] h-[14px]" />,
  },
  {
    name: "Labor",
    amount: 10800,
    percentage: 30.3,
    color: "#C4A868",
    icon: <Users className="w-[14px] h-[14px]" />,
  },
  {
    name: "Equipment",
    amount: 4200,
    percentage: 11.8,
    color: "#9DB582",
    icon: <Truck className="w-[14px] h-[14px]" />,
  },
  {
    name: "Overhead",
    amount: 3400,
    percentage: 9.6,
    color: "#B58289",
    icon: <Building2 className="w-[14px] h-[14px]" />,
  },
  {
    name: "Insurance",
    amount: 1800,
    percentage: 5.1,
    color: "#A182B5",
    icon: <ShieldCheck className="w-[14px] h-[14px]" />,
  },
  {
    name: "Utilities",
    amount: 1200,
    percentage: 3.4,
    color: "#6B7280",
    icon: <Zap className="w-[14px] h-[14px]" />,
  },
];

const recentTransactions: Transaction[] = [
  {
    id: "t1",
    date: "Feb 15",
    description: "Payment received - Kitchen Renovation",
    category: "Project Income",
    amount: 17000,
    type: "income",
    status: "completed",
    client: "John Smith",
    project: "Kitchen Renovation",
  },
  {
    id: "t2",
    date: "Feb 14",
    description: "Lumber Supply Co - Materials",
    category: "Materials",
    amount: 3200,
    type: "expense",
    status: "completed",
  },
  {
    id: "t3",
    date: "Feb 14",
    description: "Deposit received - Deck Installation",
    category: "Project Income",
    amount: 6250,
    type: "income",
    status: "completed",
    client: "Bob Johnson",
    project: "Deck Installation",
  },
  {
    id: "t4",
    date: "Feb 13",
    description: "Payroll - Week ending Feb 9",
    category: "Labor",
    amount: 5400,
    type: "expense",
    status: "completed",
  },
  {
    id: "t5",
    date: "Feb 13",
    description: "Home Depot - Supplies",
    category: "Materials",
    amount: 890,
    type: "expense",
    status: "completed",
  },
  {
    id: "t6",
    date: "Feb 12",
    description: "Equipment rental - Excavator",
    category: "Equipment",
    amount: 1500,
    type: "expense",
    status: "completed",
  },
  {
    id: "t7",
    date: "Feb 12",
    description: "Payment received - Plumbing Repair",
    category: "Project Income",
    amount: 2400,
    type: "income",
    status: "completed",
    client: "Alice Williams",
    project: "Plumbing Repair",
  },
  {
    id: "t8",
    date: "Feb 11",
    description: "Insurance premium - Monthly",
    category: "Insurance",
    amount: 1800,
    type: "expense",
    status: "completed",
  },
  {
    id: "t9",
    date: "Feb 10",
    description: "Office utilities - Feb",
    category: "Utilities",
    amount: 420,
    type: "expense",
    status: "pending",
  },
  {
    id: "t10",
    date: "Feb 10",
    description: "Flooring wholesaler - Materials order",
    category: "Materials",
    amount: 4800,
    type: "expense",
    status: "pending",
  },
];

// ---------------------------------------------------------------------------
// CSS Bar Chart Component
// ---------------------------------------------------------------------------
function RevenueChart({ data }: { data: MonthlyData[] }) {
  const maxValue = Math.max(...data.map((d) => Math.max(d.revenue, d.expenses)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mohave text-card-title text-text-primary">
          Revenue vs Expenses
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-[4px]">
            <div className="w-[10px] h-[10px] rounded-sm bg-ops-accent" />
            <span className="font-kosugi text-[10px] text-text-disabled">Revenue</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <div className="w-[10px] h-[10px] rounded-sm bg-ops-error" />
            <span className="font-kosugi text-[10px] text-text-disabled">Expenses</span>
          </div>
        </div>
      </div>

      {/* Y-axis labels + bars */}
      <div className="flex gap-1">
        {/* Y-axis */}
        <div className="flex flex-col justify-between h-[200px] pr-0.5">
          {[maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map(
            (val, i) => (
              <span key={i} className="font-mono text-[9px] text-text-disabled text-right w-[36px]">
                ${(val / 1000).toFixed(0)}k
              </span>
            )
          )}
        </div>

        {/* Chart area */}
        <div className="flex-1 relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-border-subtle w-full" />
            ))}
          </div>

          {/* Bars */}
          <div className="relative h-[200px] flex items-end justify-around gap-1 px-0.5">
            {data.map((month) => (
              <div key={month.shortMonth} className="flex-1 flex flex-col items-center gap-[2px]">
                <div className="flex items-end gap-[3px] h-[180px] w-full justify-center">
                  {/* Revenue bar */}
                  <div
                    className="flex-1 max-w-[24px] bg-ops-accent rounded-t-sm transition-all duration-500 relative group"
                    style={{
                      height: `${(month.revenue / maxValue) * 100}%`,
                    }}
                  >
                    <div className="absolute -top-[18px] left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-background-card border border-border rounded px-[6px] py-[2px] whitespace-nowrap z-10">
                      <span className="font-mono text-[9px] text-ops-accent">
                        ${(month.revenue / 1000).toFixed(1)}k
                      </span>
                    </div>
                  </div>
                  {/* Expense bar */}
                  <div
                    className="flex-1 max-w-[24px] bg-ops-error/70 rounded-t-sm transition-all duration-500 relative group"
                    style={{
                      height: `${(month.expenses / maxValue) * 100}%`,
                    }}
                  >
                    <div className="absolute -top-[18px] left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-background-card border border-border rounded px-[6px] py-[2px] whitespace-nowrap z-10">
                      <span className="font-mono text-[9px] text-ops-error">
                        ${(month.expenses / 1000).toFixed(1)}k
                      </span>
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10px] text-text-disabled">
                  {month.shortMonth}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expense Breakdown Component
// ---------------------------------------------------------------------------
function ExpenseBreakdown({ categories }: { categories: ExpenseCategory[] }) {
  const total = categories.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mohave text-card-title text-text-primary">
          Expense Breakdown
        </h3>
        <span className="font-mono text-[11px] text-text-disabled">
          ${(total / 1000).toFixed(1)}k total
        </span>
      </div>

      {/* Visual bar */}
      <div className="h-[8px] rounded-full overflow-hidden flex">
        {categories.map((cat) => (
          <div
            key={cat.name}
            className="h-full transition-all duration-500"
            style={{
              width: `${cat.percentage}%`,
              backgroundColor: cat.color,
            }}
            title={`${cat.name}: ${cat.percentage}%`}
          />
        ))}
      </div>

      {/* Category list */}
      <div className="space-y-1">
        {categories.map((cat) => (
          <div
            key={cat.name}
            className="flex items-center gap-1.5 group hover:bg-background-elevated/50 rounded px-1 py-0.5 transition-colors"
          >
            <div
              className="w-[24px] h-[24px] rounded flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${cat.color}20` }}
            >
              <span style={{ color: cat.color }}>{cat.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-mohave text-body-sm text-text-primary">
                  {cat.name}
                </span>
                <span className="font-mono text-[12px] text-text-secondary">
                  ${cat.amount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-[2px]">
                <div className="flex-1 h-[3px] bg-background-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${cat.percentage}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-text-disabled w-[32px] text-right">
                  {cat.percentage}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounting Page
// ---------------------------------------------------------------------------
export default function AccountingPage() {
  const currentMonth = monthlyData[monthlyData.length - 1];
  const previousMonth = monthlyData[monthlyData.length - 2];

  const monthlyRevenue = currentMonth.revenue;
  const monthlyExpenses = currentMonth.expenses;
  const netProfit = monthlyRevenue - monthlyExpenses;
  const profitMargin = Math.round((netProfit / monthlyRevenue) * 100);

  const ytdRevenue = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const ytdExpenses = monthlyData.reduce((s, d) => s + d.expenses, 0);
  const ytdProfit = ytdRevenue - ytdExpenses;

  const revenueChange =
    previousMonth.revenue > 0
      ? Math.round(
          ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) * 100
        )
      : 0;

  const expenseChange =
    previousMonth.expenses > 0
      ? Math.round(
          ((currentMonth.expenses - previousMonth.expenses) / previousMonth.expenses) * 100
        )
      : 0;

  return (
    <div className="flex flex-col h-full space-y-2 overflow-auto">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              ACCOUNTING
            </h1>
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              Financial overview &middot; February 2024
            </p>
          </div>
          <Badge variant="info" className="gap-[4px]">
            <AlertTriangle className="w-[10px] h-[10px]" />
            Coming Soon - Full Accounting Module
          </Badge>
        </div>
      </div>

      {/* Stat cards row */}
      <div className="shrink-0 grid grid-cols-4 gap-2">
        {/* Monthly Revenue */}
        <Card className="p-1.5">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Monthly Revenue
              </span>
              <span className="font-mono text-data-lg text-text-primary mt-0.5 block">
                ${(monthlyRevenue / 1000).toFixed(1)}k
              </span>
            </div>
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center">
              <DollarSign className="w-[16px] h-[16px] text-ops-accent" />
            </div>
          </div>
          <div className="flex items-center gap-[4px] mt-1">
            {revenueChange >= 0 ? (
              <ArrowUpRight className="w-[12px] h-[12px] text-status-success" />
            ) : (
              <ArrowDownRight className="w-[12px] h-[12px] text-ops-error" />
            )}
            <span
              className={cn(
                "font-mono text-[11px]",
                revenueChange >= 0 ? "text-status-success" : "text-ops-error"
              )}
            >
              {revenueChange >= 0 ? "+" : ""}
              {revenueChange}% vs last month
            </span>
          </div>
        </Card>

        {/* Monthly Expenses */}
        <Card className="p-1.5">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Monthly Expenses
              </span>
              <span className="font-mono text-data-lg text-text-primary mt-0.5 block">
                ${(monthlyExpenses / 1000).toFixed(1)}k
              </span>
            </div>
            <div className="w-[32px] h-[32px] rounded bg-ops-error-muted flex items-center justify-center">
              <TrendingDown className="w-[16px] h-[16px] text-ops-error" />
            </div>
          </div>
          <div className="flex items-center gap-[4px] mt-1">
            {expenseChange <= 0 ? (
              <ArrowDownRight className="w-[12px] h-[12px] text-status-success" />
            ) : (
              <ArrowUpRight className="w-[12px] h-[12px] text-ops-error" />
            )}
            <span
              className={cn(
                "font-mono text-[11px]",
                expenseChange <= 0 ? "text-status-success" : "text-ops-error"
              )}
            >
              {expenseChange >= 0 ? "+" : ""}
              {expenseChange}% vs last month
            </span>
          </div>
        </Card>

        {/* Net Profit */}
        <Card className="p-1.5">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Net Profit
              </span>
              <span
                className={cn(
                  "font-mono text-data-lg mt-0.5 block",
                  netProfit >= 0 ? "text-status-success" : "text-ops-error"
                )}
              >
                ${(netProfit / 1000).toFixed(1)}k
              </span>
            </div>
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center">
              <TrendingUp className="w-[16px] h-[16px] text-status-success" />
            </div>
          </div>
          <div className="flex items-center gap-[4px] mt-1">
            <span className="font-mono text-[11px] text-ops-amber">
              {profitMargin}% margin
            </span>
          </div>
        </Card>

        {/* YTD Revenue */}
        <Card className="p-1.5">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Year-to-Date Revenue
              </span>
              <span className="font-mono text-data-lg text-ops-amber mt-0.5 block">
                ${(ytdRevenue / 1000).toFixed(1)}k
              </span>
            </div>
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center">
              <BarChart3 className="w-[16px] h-[16px] text-ops-amber" />
            </div>
          </div>
          <div className="flex items-center gap-[4px] mt-1">
            <span className="font-mono text-[11px] text-text-disabled">
              YTD Profit:{" "}
              <span className="text-status-success">
                ${(ytdProfit / 1000).toFixed(1)}k
              </span>
            </span>
          </div>
        </Card>
      </div>

      {/* Two-column layout: Revenue Chart + Expense Breakdown */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-2">
          <RevenueChart data={monthlyData} />
        </Card>
        <Card className="p-2">
          <ExpenseBreakdown categories={expenseCategories} />
        </Card>
      </div>

      {/* P&L Summary */}
      <Card className="p-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-mohave text-card-title text-text-primary">
            Profit &amp; Loss Summary
          </h3>
          <Badge variant="info" className="gap-[4px]">
            <Calendar className="w-[10px] h-[10px]" />
            February 2024
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="border border-border rounded p-1.5">
            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block mb-0.5">
              Total Revenue
            </span>
            <span className="font-mono text-data-lg text-text-primary block">
              ${monthlyRevenue.toLocaleString()}
            </span>
            <div className="mt-1 space-y-[4px]">
              <div className="flex items-center justify-between">
                <span className="font-kosugi text-[9px] text-text-disabled">Project Income</span>
                <span className="font-mono text-[11px] text-text-secondary">
                  ${(monthlyRevenue * 0.92).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-kosugi text-[9px] text-text-disabled">Service Calls</span>
                <span className="font-mono text-[11px] text-text-secondary">
                  ${(monthlyRevenue * 0.08).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="border border-border rounded p-1.5">
            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block mb-0.5">
              Total Expenses
            </span>
            <span className="font-mono text-data-lg text-ops-error block">
              -${monthlyExpenses.toLocaleString()}
            </span>
            <div className="mt-1 space-y-[4px]">
              {expenseCategories.slice(0, 3).map((cat) => (
                <div key={cat.name} className="flex items-center justify-between">
                  <span className="font-kosugi text-[9px] text-text-disabled">{cat.name}</span>
                  <span className="font-mono text-[11px] text-text-secondary">
                    -${cat.amount.toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="font-kosugi text-[9px] text-text-disabled">Other</span>
                <span className="font-mono text-[11px] text-text-secondary">
                  -$
                  {(
                    monthlyExpenses -
                    expenseCategories.slice(0, 3).reduce((s, c) => s + c.amount, 0)
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "border rounded p-1.5",
              netProfit >= 0
                ? "border-status-success/30 bg-status-success/5"
                : "border-ops-error/30 bg-ops-error-muted"
            )}
          >
            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block mb-0.5">
              Net Profit
            </span>
            <span
              className={cn(
                "font-mono text-data-lg block",
                netProfit >= 0 ? "text-status-success" : "text-ops-error"
              )}
            >
              ${netProfit.toLocaleString()}
            </span>
            <div className="mt-1 space-y-[4px]">
              <div className="flex items-center justify-between">
                <span className="font-kosugi text-[9px] text-text-disabled">Profit Margin</span>
                <span className="font-mono text-[11px] text-ops-amber">{profitMargin}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-kosugi text-[9px] text-text-disabled">Revenue/Expense</span>
                <span className="font-mono text-[11px] text-text-secondary">
                  {(monthlyRevenue / monthlyExpenses).toFixed(2)}x
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Recent Transactions */}
      <Card className="p-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-mohave text-card-title text-text-primary">
            Recent Transactions
          </h3>
          <span className="font-mono text-[11px] text-text-disabled">
            {recentTransactions.length} transactions
          </span>
        </div>

        <div className="space-y-0">
          {/* Table header */}
          <div className="grid grid-cols-[80px_1fr_120px_100px_100px_80px] gap-1 px-1 py-0.5 border-b border-border">
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
              Date
            </span>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
              Description
            </span>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
              Category
            </span>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
              Client
            </span>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest text-right">
              Amount
            </span>
            <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest text-center">
              Status
            </span>
          </div>

          {/* Rows */}
          {recentTransactions.map((txn) => (
            <div
              key={txn.id}
              className="grid grid-cols-[80px_1fr_120px_100px_100px_80px] gap-1 px-1 py-1 hover:bg-background-elevated/50 transition-colors border-b border-border-subtle last:border-b-0"
            >
              <span className="font-mono text-[12px] text-text-disabled self-center">
                {txn.date}
              </span>
              <div className="self-center min-w-0">
                <span className="font-mohave text-body-sm text-text-primary block truncate">
                  {txn.description}
                </span>
              </div>
              <span className="font-kosugi text-[11px] text-text-tertiary self-center">
                {txn.category}
              </span>
              <span className="font-mohave text-[12px] text-text-secondary self-center truncate">
                {txn.client || "--"}
              </span>
              <span
                className={cn(
                  "font-mono text-body-sm self-center text-right",
                  txn.type === "income" ? "text-status-success" : "text-ops-error"
                )}
              >
                {txn.type === "income" ? "+" : "-"}${txn.amount.toLocaleString()}
              </span>
              <div className="self-center flex justify-center">
                <Badge
                  variant={txn.status === "completed" ? "success" : "warning"}
                  className="text-[9px]"
                >
                  {txn.status === "completed" ? "Done" : "Pending"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Coming Soon features */}
      <div className="shrink-0 grid grid-cols-3 gap-2 pb-2">
        <Card className="p-1.5 border-dashed border-border-subtle opacity-60">
          <div className="flex items-center gap-1 mb-1">
            <FileText className="w-[16px] h-[16px] text-text-disabled" />
            <span className="font-mohave text-body text-text-disabled">Tax Reports</span>
          </div>
          <p className="font-kosugi text-[10px] text-text-disabled">
            Generate quarterly and annual tax reports with category breakdowns.
          </p>
          <Badge variant="info" className="mt-1 text-[9px]">
            Coming Soon
          </Badge>
        </Card>
        <Card className="p-1.5 border-dashed border-border-subtle opacity-60">
          <div className="flex items-center gap-1 mb-1">
            <PieChart className="w-[16px] h-[16px] text-text-disabled" />
            <span className="font-mohave text-body text-text-disabled">Budget Tracking</span>
          </div>
          <p className="font-kosugi text-[10px] text-text-disabled">
            Set category budgets and track spending with alerts for overages.
          </p>
          <Badge variant="info" className="mt-1 text-[9px]">
            Coming Soon
          </Badge>
        </Card>
        <Card className="p-1.5 border-dashed border-border-subtle opacity-60">
          <div className="flex items-center gap-1 mb-1">
            <BarChart3 className="w-[16px] h-[16px] text-text-disabled" />
            <span className="font-mohave text-body text-text-disabled">QuickBooks Sync</span>
          </div>
          <p className="font-kosugi text-[10px] text-text-disabled">
            Two-way sync with QuickBooks for automated bookkeeping.
          </p>
          <Badge variant="info" className="mt-1 text-[9px]">
            Coming Soon
          </Badge>
        </Card>
      </div>
    </div>
  );
}
