import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { desc, eq } from "drizzle-orm";
import { comments, feeds, users } from "../db/schema";
import { profileAsync } from "../core/server-timing";
import { notify } from "../utils/webhook";
import { resolveWebhookConfig } from "./config-helpers";

const GUEST_ADJECTIVES = ["快乐的", "聪明的", "勇敢的", "可爱的", "温柔的", "活泼的", "淡定的", "认真的", "热情的", "安静的"];
const GUEST_NOUNS = ["小熊", "小猫", "小鱼", "小鸟", "小兔", "小虎", "小龙", "小鹿", "小狐", "小鲸"];

function generateGuestName(): string {
    const adj = GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)];
    const noun = GUEST_NOUNS[Math.floor(Math.random() * GUEST_NOUNS.length)];
    return `${adj}${noun}`;
}

function generateGuestAvatar(name: string): string {
    return `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(name)}`;
}

export function CommentService(): Hono {
    const app = new Hono();

    app.get('/:feed', async (c: AppContext) => {
        const db = c.get('db');
        const feedId = parseInt(c.req.param('feed'));
        
        const comment_list = await profileAsync(c, 'comment_list_db', () => db.query.comments.findMany({
            where: eq(comments.feedId, feedId),
            columns: { feedId: false, userId: false, guestName: false, guestAvatar: false },
            with: {
                user: {
                    columns: { id: true, username: true, avatar: true, permission: true }
                }
            },
            orderBy: [desc(comments.createdAt)]
        }));

        const enriched = comment_list.map((comment: any) => {
            if (!comment.user) {
                comment.user = {
                    id: 0,
                    username: comment.guestName || "匿名游客",
                    avatar: comment.guestAvatar || null,
                    permission: null,
                };
            }
            return comment;
        });
        
        return c.json(enriched);
    });

    app.post('/:feed', async (c: AppContext) => {
        const db = c.get('db');
        const env = c.get('env');
        const serverConfig = c.get('serverConfig');
        const uid = c.get('uid');
        const feedId = parseInt(c.req.param('feed'));
        const body = await profileAsync(c, 'comment_create_parse', () => c.req.json());
        const { content, guestName } = body;
        
        if (!content) {
            return c.text('Content is required', 400);
        }
        
        const exist = await profileAsync(c, 'comment_create_feed', () => db.query.feeds.findFirst({ where: eq(feeds.id, feedId) }));
        if (!exist) {
            return c.text('Feed not found', 400);
        }

        let commentGuestName: string | null = null;
        let commentGuestAvatar: string | null = null;
        let username: string;

        if (uid) {
            const user = await profileAsync(c, 'comment_create_user', () => db.query.users.findFirst({ where: eq(users.id, uid) }));
            if (!user) {
                return c.text('User not found', 400);
            }
            username = user.username;
        } else {
            commentGuestName = (guestName && guestName.trim()) || generateGuestName();
            commentGuestAvatar = generateGuestAvatar(commentGuestName);
            username = commentGuestName;
        }

        await profileAsync(c, 'comment_create_insert', () => db.insert(comments).values({
            feedId,
            userId: uid || null,
            guestName: commentGuestName,
            guestAvatar: commentGuestAvatar,
            content
        }));

        const {
            webhookUrl,
            webhookMethod,
            webhookContentType,
            webhookHeaders,
            webhookBodyTemplate,
        } = await profileAsync(c, 'comment_create_webhook_config', () => resolveWebhookConfig(serverConfig, env));
        const frontendUrl = new URL(c.req.url).origin;
        try {
            await profileAsync(c, 'comment_create_notify', () => notify(
                webhookUrl || "",
                {
                    event: "comment.created",
                    message: `${frontendUrl}/feed/${feedId}\n${username} 评论了: ${exist.title}\n${content}`,
                    title: exist.title || "",
                    url: `${frontendUrl}/feed/${feedId}`,
                    username,
                    content,
                },
                {
                    method: webhookMethod,
                    contentType: webhookContentType,
                    headers: webhookHeaders,
                    bodyTemplate: webhookBodyTemplate,
                },
            ));
        } catch (error) {
            console.error("Failed to send comment webhook", error);
        }
        return c.text('OK');
    });

    app.delete('/:id', async (c: AppContext) => {
        const db = c.get('db');
        const uid = c.get('uid');
        const admin = c.get('admin');
        
        if (uid === undefined) {
            return c.text('Unauthorized', 401);
        }
        
        const id_num = parseInt(c.req.param('id'));
        const comment = await profileAsync(c, 'comment_delete_lookup', () => db.query.comments.findFirst({ where: eq(comments.id, id_num) }));
        
        if (!comment) {
            return c.text('Not found', 404);
        }
        
        if (!admin && comment.userId !== uid) {
            return c.text('Permission denied', 403);
        }
        
        await profileAsync(c, 'comment_delete_db', () => db.delete(comments).where(eq(comments.id, id_num)));
        return c.text('OK');
    });

    return app;
}
