import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoadmapDto } from './dto/create-roadmap.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateTopicDto } from './dto/create-topic.dto';

const REVISITS_FOR_FULL_MEMORY = 5;

@Injectable()
export class RoadmapsService {
  constructor(private prisma: PrismaService) {}

  // ── Roadmaps ──────────────────────────────────────────────────

  async listRoadmaps() {
    return this.prisma.roadmap.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { categories: true } } },
    });
  }

  async createRoadmap(dto: CreateRoadmapDto, creatorId: string) {
    const existing = await this.prisma.roadmap.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A roadmap with this name already exists');

    return this.prisma.roadmap.create({
      data: { name: dto.name, description: dto.description, createdById: creatorId },
    });
  }

  async deleteRoadmap(id: string) {
    const roadmap = await this.prisma.roadmap.findUnique({ where: { id } });
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    await this.prisma.roadmap.delete({ where: { id } });
    return { message: 'Roadmap deleted' };
  }

  // Returns the roadmap with nested categories -> topics, each topic carrying
  // *this* user's progress (completed + a 0-100 memory-bar value derived from
  // revisitCount, capped at REVISITS_FOR_FULL_MEMORY revisits).
  async getRoadmap(id: string, userId: string) {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { id },
      include: {
        categories: {
          orderBy: { order: 'asc' },
          include: {
            topics: {
              orderBy: { order: 'asc' },
              include: { progress: { where: { userId } } },
            },
          },
        },
      },
    });
    if (!roadmap) throw new NotFoundException('Roadmap not found');

    const categories = roadmap.categories.map(category => {
      const topics = category.topics.map(topic => {
        const p = topic.progress[0];
        const { progress: _drop, ...topicRest } = topic;
        return {
          ...topicRest,
          completed: p?.completed ?? false,
          revisitCount: p?.revisitCount ?? 0,
          memoryPercent: Math.min(100, Math.round(((p?.revisitCount ?? 0) / REVISITS_FOR_FULL_MEMORY) * 100)),
        };
      });
      const done = topics.filter(t => t.completed).length;
      return {
        ...category,
        topics,
        progressPercent: topics.length === 0 ? 0 : Math.round((done / topics.length) * 100),
      };
    });

    return { ...roadmap, categories };
  }

  // ── Categories ────────────────────────────────────────────────

  async createCategory(roadmapId: string, dto: CreateCategoryDto) {
    const roadmap = await this.prisma.roadmap.findUnique({ where: { id: roadmapId } });
    if (!roadmap) throw new NotFoundException('Roadmap not found');

    const existing = await this.prisma.roadmapCategory.findUnique({
      where: { roadmapId_name: { roadmapId, name: dto.name } },
    });
    if (existing) throw new ConflictException('A category with this name already exists on this roadmap');

    const count = await this.prisma.roadmapCategory.count({ where: { roadmapId } });
    return this.prisma.roadmapCategory.create({
      data: { roadmapId, name: dto.name, order: count },
    });
  }

  async deleteCategory(categoryId: string) {
    const category = await this.prisma.roadmapCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found');
    await this.prisma.roadmapCategory.delete({ where: { id: categoryId } });
    return { message: 'Category deleted' };
  }

  // ── Topics ────────────────────────────────────────────────────

  async createTopic(categoryId: string, dto: CreateTopicDto) {
    const category = await this.prisma.roadmapCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found');

    const existing = await this.prisma.interviewTopic.findUnique({
      where: { categoryId_title: { categoryId, title: dto.title } },
    });
    if (existing) throw new ConflictException('A topic with this title already exists in this category');

    const count = await this.prisma.interviewTopic.count({ where: { categoryId } });
    return this.prisma.interviewTopic.create({
      data: { categoryId, title: dto.title, description: dto.description, order: count },
    });
  }

  async deleteTopic(topicId: string) {
    const topic = await this.prisma.interviewTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');
    await this.prisma.interviewTopic.delete({ where: { id: topicId } });
    return { message: 'Topic deleted' };
  }

  // ── Per-user progress ─────────────────────────────────────────

  async setCompleted(topicId: string, userId: string, completed: boolean) {
    const topic = await this.prisma.interviewTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');

    const progress = await this.prisma.userTopicProgress.upsert({
      where: { userId_topicId: { userId, topicId } },
      update: { completed },
      create: { userId, topicId, completed },
    });
    return { ...progress, memoryPercent: Math.min(100, Math.round((progress.revisitCount / REVISITS_FOR_FULL_MEMORY) * 100)) };
  }

  async revisit(topicId: string, userId: string) {
    const topic = await this.prisma.interviewTopic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');

    // Atomic increment (not read-then-write) so two rapid clicks can't race
    // and lose an update -- Postgres applies "revisitCount = revisitCount + 1"
    // as a single operation.
    const progress = await this.prisma.userTopicProgress.upsert({
      where: { userId_topicId: { userId, topicId } },
      update: { revisitCount: { increment: 1 }, lastRevisitedAt: new Date() },
      create: { userId, topicId, revisitCount: 1, lastRevisitedAt: new Date() },
    });
    return { ...progress, memoryPercent: Math.min(100, Math.round((progress.revisitCount / REVISITS_FOR_FULL_MEMORY) * 100)) };
  }
}
