const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    // Create Tenant
    const tenant = await prisma.tenant.upsert({
        where: { id: 'default-tenant' },
        update: {},
        create: {
            id: 'default-tenant',
            name: 'Nexus Control Center',
        },
    });

    // Create Admin User
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.user.upsert({
        where: { email: 'admin@local' },
        update: {},
        create: {
            email: 'admin@local',
            password: hashedPassword,
            name: 'Admin User',
            role: 'ADMIN',
            tenantId: tenant.id,
        },
    });

    // Create Sample Clients
    const clients = [
        { name: 'Ana Júlia', token: 'pk_1118361_client1' },
        { name: 'Steve', token: 'pk_7289902_client2' },
        { name: 'Caique', token: 'pk_1118417_client3' },
    ];

    for (const c of clients) {
        try {
            await prisma.client.create({
                data: {
                    name: c.name,
                    tenantId: tenant.id,
                    status: 'ACTIVE',
                    dashboards: {
                        create: {
                            token: c.token,
                            tenantId: tenant.id,
                        }
                    }
                },
            });
        } catch (e) {
            console.log(`Client ${c.name} might already exist`);
        }
    }

    console.log('Seed completed successfully');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
