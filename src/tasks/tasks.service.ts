import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string, status?: string, priority?: string, search?: string) {
    return this.prisma.task.findMany({
      where: {
        userId,
        parentId: null, // only top-level tasks
        ...(status && { status: status as any }),
        ...(priority && { priority: priority as any }),
        ...(search && {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        subTasks: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { subTasks: { orderBy: { createdAt: 'asc' } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId !== userId) throw new ForbiddenException();
    return task;
  }

  async create(userId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        completedAt: dto.status === 'DONE' ? new Date() : undefined,
        userId,
      },
      include: { subTasks: true },
    });
  }

  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const existing = await this.findOne(id, userId);

    let completedAt: Date | null | undefined = undefined;
    if (dto.status === 'DONE' && existing.status !== 'DONE') {
      completedAt = new Date();
    } else if (dto.status && dto.status !== 'DONE' && existing.status === 'DONE') {
      completedAt = null;
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
      include: { subTasks: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    await this.prisma.task.delete({ where: { id } });
    return { message: 'Task deleted' };
  }

  // ── Sub-task methods ──────────────────────────────────────────

  async createSubTask(parentId: string, userId: string, title: string) {
    await this.findOne(parentId, userId); // verify ownership
    return this.prisma.task.create({
      data: { title, userId, parentId, status: 'TODO', priority: 'MEDIUM' },
    });
  }

  async toggleSubTask(subId: string, parentId: string, userId: string) {
    const sub = await this.prisma.task.findUnique({ where: { id: subId } });
    if (!sub || sub.userId !== userId || sub.parentId !== parentId) {
      throw new ForbiddenException();
    }
    const newStatus = sub.status === 'DONE' ? 'TODO' : 'DONE';
    return this.prisma.task.update({
      where: { id: subId },
      data: {
        status: newStatus,
        completedAt: newStatus === 'DONE' ? new Date() : null,
      },
    });
  }

  async removeSubTask(subId: string, parentId: string, userId: string) {
    const sub = await this.prisma.task.findUnique({ where: { id: subId } });
    if (!sub || sub.userId !== userId || sub.parentId !== parentId) {
      throw new ForbiddenException();
    }
    await this.prisma.task.delete({ where: { id: subId } });
    return { message: 'Sub-task deleted' };
  }

  // ── Streak ────────────────────────────────────────────────────

  async getStreak(userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { userId, completedAt: { not: null } },
      select: { completedAt: true },
    });

    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

    // Build calendar: date string → count of tasks completed that day
    const calendar: Record<string, number> = {};
    tasks.forEach(t => {
      const d = toDateStr(t.completedAt!);
      calendar[d] = (calendar[d] || 0) + 1;
    });

    if (tasks.length === 0) return { current: 0, best: 0, calendar };

    const uniqueDates = [...new Set(tasks.map(t => toDateStr(t.completedAt!)))];
    const dateSet = new Set(uniqueDates);
    const sorted = [...uniqueDates].sort();

    const now = new Date();
    const todayStr = toDateStr(now);
    const yesterdayStr = toDateStr(new Date(now.getTime() - 86400000));

    let current = 0;
    let startStr = dateSet.has(todayStr)
      ? todayStr
      : dateSet.has(yesterdayStr)
      ? yesterdayStr
      : null;

    if (startStr) {
      let d = new Date(startStr + 'T12:00:00Z');
      while (dateSet.has(toDateStr(d))) {
        current++;
        d = new Date(d.getTime() - 86400000);
      }
    }

    let best = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + 'T12:00:00Z');
      const curr = new Date(sorted[i] + 'T12:00:00Z');
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      if (diffDays === 1) {
        run++;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }

    return { current, best: Math.max(best, current), calendar };
  }
}
