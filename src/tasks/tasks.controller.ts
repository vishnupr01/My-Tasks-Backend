import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
  ) {
    return this.tasksService.findAll(user.id, status, priority, search);
  }

  @Get('streak')
  getStreak(@CurrentUser() user: JwtUser) {
    return this.tasksService.getStreak(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.tasksService.findOne(id, user.id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: JwtUser) {
    return this.tasksService.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @CurrentUser() user: JwtUser) {
    return this.tasksService.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.tasksService.remove(id, user.id);
  }

  // ── Sub-task routes ──────────────────────────────────────────

  @Post(':id/subtasks')
  createSubTask(
    @Param('id') parentId: string,
    @Body('title') title: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.tasksService.createSubTask(parentId, user.id, title);
  }

  @Patch(':id/subtasks/:subId')
  toggleSubTask(
    @Param('id') parentId: string,
    @Param('subId') subId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.tasksService.toggleSubTask(subId, parentId, user.id);
  }

  @Delete(':id/subtasks/:subId')
  removeSubTask(
    @Param('id') parentId: string,
    @Param('subId') subId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.tasksService.removeSubTask(subId, parentId, user.id);
  }
}
