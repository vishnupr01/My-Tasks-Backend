import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateSettingsDto } from "./dto/update-settings.dto";


@Injectable()
export class UserService{
    constructor(private prisma: PrismaService) {}

    async getSettings(userId: string) {
        return this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { notificationsEnabled: true, notificationSoundEnabled: true },
        });
    }

    async updateSettings(userId: string, dto: UpdateSettingsDto) {
        return this.prisma.user.update({
            where: { id: userId },
            data: dto,
            select: { notificationsEnabled: true, notificationSoundEnabled: true },
        });
    }

    async searchUsers(query: string, currentUserId: string){
        if (!query || !query.trim()) return [];

        return this.prisma.user.findMany({
            where:{
                id:{not:currentUserId},
                OR:[
                    {
                        name:{
                            contains:query,
                            mode: "insensitive"
                        }
                    },
                    {
                        email:{
                            contains:query,
                            mode: "insensitive"
                        }
                    },
                    {
                        username:{
                            contains:query,
                            mode: "insensitive"
                        }
                    }
                ]
            },
            select:{
                id: true,
                name: true,
                username: true
            },
            orderBy: { username: 'asc' },
            take: 20
        })
    }

}
