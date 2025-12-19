---
name: prisma-patterns
description: Prisma ORM 패턴 및 데이터베이스 작업 가이드
---

# Prisma Patterns for TubeArchive

## Schema Location
`prisma/schema.prisma`

## Core Models
- User, Workspace, WorkspaceMember
- ContentItem (unified content model)
- Collection, CollectionItem
- Activity, Notification

## Migration Commands
```bash
npx prisma migrate dev --name <migration-name>
npx prisma generate
npx prisma db push  # Development only
```

## Query Patterns
```typescript
// Use transactions for related operations
await prisma.$transaction([
  prisma.contentItem.create({ data }),
  prisma.activity.create({ data: activityData })
]);

// Use include/select for related data
const workspace = await prisma.workspace.findUnique({
  where: { id },
  include: { members: true, collections: true }
});
```

## Performance Guidelines
- Add indexes for frequently queried fields
- Use cursor-based pagination for large datasets
- Implement soft deletes with `deletedAt` field
