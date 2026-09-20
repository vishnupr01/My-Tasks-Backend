import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { RoadmapsService } from './roadmaps.service';
import { CreateRoadmapDto } from './dto/create-roadmap.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('roadmaps')
@UseGuards(JwtAuthGuard)
export class RoadmapsController {
  constructor(private roadmapsService: RoadmapsService) {}

  @Get()
  list() {
    return this.roadmapsService.listRoadmaps();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateRoadmapDto, @CurrentUser() user: JwtUser) {
    return this.roadmapsService.createRoadmap(dto, user.id);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.roadmapsService.getRoadmap(id, user.id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.roadmapsService.deleteRoadmap(id);
  }

  @Post(':id/categories')
  @UseGuards(AdminGuard)
  createCategory(@Param('id') id: string, @Body() dto: CreateCategoryDto) {
    return this.roadmapsService.createCategory(id, dto);
  }

  @Delete('categories/:categoryId')
  @UseGuards(AdminGuard)
  removeCategory(@Param('categoryId') categoryId: string) {
    return this.roadmapsService.deleteCategory(categoryId);
  }

  @Post('categories/:categoryId/topics')
  @UseGuards(AdminGuard)
  createTopic(@Param('categoryId') categoryId: string, @Body() dto: CreateTopicDto) {
    return this.roadmapsService.createTopic(categoryId, dto);
  }

  @Delete('topics/:topicId')
  @UseGuards(AdminGuard)
  removeTopic(@Param('topicId') topicId: string) {
    return this.roadmapsService.deleteTopic(topicId);
  }

  @Patch('topics/:topicId/progress')
  setProgress(
    @Param('topicId') topicId: string,
    @Body('completed') completed: boolean,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roadmapsService.setCompleted(topicId, user.id, completed);
  }

  @Post('topics/:topicId/revisit')
  revisit(@Param('topicId') topicId: string, @CurrentUser() user: JwtUser) {
    return this.roadmapsService.revisit(topicId, user.id);
  }
}
