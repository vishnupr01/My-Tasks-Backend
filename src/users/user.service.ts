import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";


@Injectable()
export class UserService{
    constructor(private prisma: PrismaService) {}
    
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
