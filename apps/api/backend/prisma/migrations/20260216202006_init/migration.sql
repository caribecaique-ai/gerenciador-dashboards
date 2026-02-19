-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "clickupToken" TEXT NOT NULL,
    "clickupTeamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Not Connected',
    "dashboardSlug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_dashboardSlug_key" ON "clients"("dashboardSlug");
