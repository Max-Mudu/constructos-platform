import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ── Demo company ──────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { slug: 'demo-construction' },
    update: {},
    create: {
      name: 'Demo Construction Ltd',
      slug: 'demo-construction',
      country: 'Kenya',
      currency: 'KES',
      timezone: 'Africa/Nairobi',
    },
  });

  console.log(`Company: ${company.name} (${company.id})`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Demo@1234', 12);

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'owner@demo.com',
      passwordHash,
      firstName: 'Company',
      lastName: 'Owner',
      role: 'company_admin',
      canViewFinance: true,
    },
  });

  const financeOfficer = await prisma.user.upsert({
    where: { email: 'finance@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'finance@demo.com',
      passwordHash,
      firstName: 'Finance',
      lastName: 'Officer',
      role: 'finance_officer',
      canViewFinance: true,
    },
  });

  const projectManager = await prisma.user.upsert({
    where: { email: 'pm@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'pm@demo.com',
      passwordHash,
      firstName: 'Project',
      lastName: 'Manager',
      role: 'project_manager',
      canViewFinance: false,
    },
  });

  const siteSupervisor = await prisma.user.upsert({
    where: { email: 'supervisor@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'supervisor@demo.com',
      passwordHash,
      firstName: 'Site',
      lastName: 'Supervisor',
      role: 'site_supervisor',
      canViewFinance: false,
    },
  });

  const contractor = await prisma.user.upsert({
    where: { email: 'contractor@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'contractor@demo.com',
      passwordHash,
      firstName: 'Main',
      lastName: 'Contractor',
      role: 'contractor',
      canViewFinance: false,
    },
  });

  const consultant = await prisma.user.upsert({
    where: { email: 'engineer@demo.com' },
    update: {},
    create: {
      companyId: company.id,
      email: 'engineer@demo.com',
      passwordHash,
      firstName: 'Lead',
      lastName: 'Engineer',
      role: 'consultant',
      consultantType: 'engineer',
      canViewFinance: false,
    },
  });

  console.log(`Seeded ${6} users`);

  // ── Project ───────────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { id: 'demo-project-id-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'demo-project-id-0000-0000-000000000001',
      companyId: company.id,
      name: 'Westlands Office Complex',
      code: 'WOC-2024',
      description: '12-storey mixed-use development in Westlands, Nairobi',
      status: 'active',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2026-06-30'),
      location: 'Westlands, Nairobi',
    },
  });

  // ── Job Site ──────────────────────────────────────────────────────────────
  const site = await prisma.jobSite.upsert({
    where: { id: 'demo-site-id-000000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'demo-site-id-000000-0000-0000-000000000001',
      companyId: company.id,
      projectId: project.id,
      name: 'Main Building Site',
      address: 'Westlands Road, Nairobi',
      latitude: -1.2676,
      longitude: 36.8076,
    },
  });

  // ── Project members ───────────────────────────────────────────────────────
  const memberData = [
    { userId: projectManager.id, siteId: null },
    { userId: siteSupervisor.id, siteId: site.id },
    { userId: contractor.id, siteId: null },
    { userId: consultant.id, siteId: null },
  ];

  for (const m of memberData) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: m.userId } },
      update: {},
      create: {
        companyId: company.id,
        projectId: project.id,
        userId: m.userId,
        siteId: m.siteId,
      },
    });
  }

  // ── Contractors ───────────────────────────────────────────────────────────
  const contractorRecord = await prisma.contractor.upsert({
    where: { id: 'demo-contractor-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'demo-contractor-0000-0000-0000-000000000001',
      companyId: company.id,
      userId: contractor.id,
      name: 'BuildRight Construction Ltd',
      contactPerson: 'Main Contractor',
      email: 'contractor@demo.com',
      tradeSpecialization: 'General Construction',
    },
  });

  // ── Contractor schedule ───────────────────────────────────────────────────
  await prisma.contractorSchedule.upsert({
    where: { id: 'demo-schedule-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'demo-schedule-0000-0000-0000-000000000001',
      companyId: company.id,
      projectId: project.id,
      contractorId: contractorRecord.id,
      scopeOfWork: 'Structural works — foundations and ground floor slab',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2024-08-31'),
      contractValue: 45000000,
      currency: 'KES',
      status: 'active',
    },
  });

  // ── Budget ────────────────────────────────────────────────────────────────
  const budget = await prisma.budget.upsert({
    where: { projectId: project.id },
    update: {},
    create: {
      companyId:   company.id,
      projectId:   project.id,
      name:        'WOC-2024 Main Budget',
      currency:    'KES',
      status:      'approved',
      createdById: owner.id,
      approvedById: owner.id,
      approvedAt:  new Date('2024-01-10'),
    },
  });

  // Seed all 10 budget categories
  const budgetLines = [
    { category: 'labour' as const, description: 'Site Labour', budgetedAmount: 12000000 },
    { category: 'materials' as const, description: 'Building Materials', budgetedAmount: 35000000 },
    { category: 'equipment' as const, description: 'Plant & Equipment', budgetedAmount: 8000000 },
    { category: 'subcontractors' as const, description: 'Subcontractor Works', budgetedAmount: 20000000 },
    { category: 'consultants' as const, description: 'Professional Fees', budgetedAmount: 6500000 },
    { category: 'marketing' as const, description: 'Marketing & Sales', budgetedAmount: 2000000 },
    { category: 'overheads' as const, description: 'Site Overheads', budgetedAmount: 3000000 },
    { category: 'permits_statutory' as const, description: 'Permits & Statutory Fees', budgetedAmount: 1500000 },
    { category: 'variations' as const, description: 'Variation Orders Reserve', budgetedAmount: 4000000 },
    { category: 'contingency' as const, description: 'Contingency (5%)', budgetedAmount: 4600000 },
  ];

  for (const line of budgetLines) {
    await prisma.budgetLineItem.upsert({
      where: { id: `demo-budget-line-${line.category}` },
      update: {},
      create: {
        id: `demo-budget-line-${line.category}`,
        budgetId: budget.id,
        companyId: company.id,
        projectId: project.id,
        category: line.category,
        description: line.description,
        budgetedAmount: line.budgetedAmount,
        currency: 'KES',
      },
    });
  }

  // Consultant cost entry
  const consultantLine = await prisma.budgetLineItem.findUnique({
    where: { id: 'demo-budget-line-consultants' },
  });
  if (consultantLine) {
    await prisma.consultantCostEntry.upsert({
      where: { budgetLineItemId: consultantLine.id },
      update: {},
      create: {
        budgetLineItemId: consultantLine.id,
        companyId: company.id,
        projectId: project.id,
        consultantType: 'engineer',
        consultantName: 'Lead Engineer',
        firmName: 'Apex Engineers Ltd',
        feeAgreed: 3500000,
        feePaid: 1000000,
        feeOutstanding: 2500000,
        currency: 'KES',
      },
    });
  }

  // Marketing budget entry
  const marketingLine = await prisma.budgetLineItem.findUnique({
    where: { id: 'demo-budget-line-marketing' },
  });
  if (marketingLine) {
    await prisma.marketingBudgetEntry.upsert({
      where: { budgetLineItemId: marketingLine.id },
      update: {},
      create: {
        budgetLineItemId: marketingLine.id,
        companyId: company.id,
        projectId: project.id,
        campaignName: 'Westlands Launch Campaign',
        channel: 'Digital',
        vendorAgency: 'Pixel Agency Nairobi',
        budgetedAmount: 1200000,
        actualSpend: 350000,
        paidAmount: 350000,
        expectedRoi: '15%',
        notes: 'Phase 1 digital launch — social media and Google Ads',
      },
    });
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  const supplierData = [
    {
      id:            'demo-supplier-0000-0000-0000-000000000001',
      name:          'East Africa Cement Ltd',
      contactPerson: 'James Waweru',
      email:         'orders@eacement.co.ke',
      phone:         '+254 722 100 100',
      address:       'Industrial Area, Nairobi',
    },
    {
      id:            'demo-supplier-0000-0000-0000-000000000002',
      name:          'Nairobi Steel Works',
      contactPerson: 'Grace Otieno',
      email:         'sales@nairobisteelworks.co.ke',
      phone:         '+254 733 200 200',
      address:       'Mombasa Road, Nairobi',
    },
    {
      id:            'demo-supplier-0000-0000-0000-000000000003',
      name:          'Glazetech Windows',
      contactPerson: 'Amos Mutua',
      email:         'info@glazetech.co.ke',
      phone:         '+254 711 300 300',
      address:       'Westlands, Nairobi',
    },
    {
      id:            'demo-supplier-0000-0000-0000-000000000004',
      name:          'BuildSmart Aggregates',
      contactPerson: 'Mary Njoki',
      email:         'supply@buildsmart.co.ke',
      phone:         '+254 720 400 400',
      address:       'Thika Road, Nairobi',
    },
  ];

  for (const s of supplierData) {
    await prisma.supplier.upsert({
      where:  { id: s.id },
      update: {},
      create: { ...s, companyId: company.id },
    });
  }

  console.log(`Seeded ${supplierData.length} suppliers`);

  // ── Delivery records ──────────────────────────────────────────────────────
  const deliverySeedData = [
    {
      id: 'demo-delivery-0000-0000-0000-000000000001',
      supplierName: 'East Africa Cement Ltd',
      deliveryDate: new Date('2026-04-01'),
      deliveryTime: '08:30',
      driverName: 'Peter Kariuki',
      vehicleRegistration: 'KCA 456B',
      purchaseOrderNumber: 'PO-2026-001',
      deliveryNoteNumber: 'DN-EAC-0041',
      itemDescription: 'Portland Cement 50kg bags',
      unitOfMeasure: 'bags',
      quantityOrdered: 500,
      quantityDelivered: 500,
      conditionOnArrival: 'good' as const,
      inspectionStatus: 'passed' as const,
      acceptanceStatus: 'accepted' as const,
      receivedById: siteSupervisor.id,
      comments: 'All bags in good condition. Stored in weather-proof shed.',
    },
    {
      id: 'demo-delivery-0000-0000-0000-000000000002',
      supplierName: 'Nairobi Steel Works',
      deliveryDate: new Date('2026-04-03'),
      deliveryTime: '11:00',
      driverName: 'David Mutuku',
      vehicleRegistration: 'KDB 789C',
      purchaseOrderNumber: 'PO-2026-002',
      deliveryNoteNumber: 'DN-NSW-0122',
      itemDescription: 'Y16 Reinforcement Bars 12m',
      unitOfMeasure: 'bars',
      quantityOrdered: 200,
      quantityDelivered: 180,
      conditionOnArrival: 'partial' as const,
      inspectionStatus: 'passed' as const,
      acceptanceStatus: 'partially_accepted' as const,
      discrepancyNotes: '20 bars short — supplier to deliver balance by 5 Apr',
      receivedById: siteSupervisor.id,
    },
    {
      id: 'demo-delivery-0000-0000-0000-000000000003',
      supplierName: 'Glazetech Windows',
      deliveryDate: new Date('2026-04-04'),
      deliveryTime: '14:00',
      driverName: 'Mohammed Ali',
      vehicleRegistration: 'KCB 001F',
      deliveryNoteNumber: 'DN-GTW-0010',
      itemDescription: 'Aluminium Sliding Windows 1200×900mm',
      unitOfMeasure: 'units',
      quantityOrdered: 40,
      quantityDelivered: 0,
      conditionOnArrival: 'damaged' as const,
      inspectionStatus: 'failed' as const,
      acceptanceStatus: 'rejected' as const,
      rejectionReason: 'All window frames bent during transit — returned to supplier',
      receivedById: owner.id,
      comments: 'Supplier to arrange replacement. Claim ref: GTW-CLM-2026-01',
    },
  ];

  for (const d of deliverySeedData) {
    await prisma.deliveryRecord.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        companyId: company.id,
        projectId: project.id,
        siteId: site.id,
        ...d,
      },
    });
  }

  // ── Workers ───────────────────────────────────────────────────────────────
  const workerSeedData = [
    {
      id: 'demo-worker-000000-0000-0000-000000000001',
      firstName: 'Peter',   lastName: 'Kamau',
      trade: 'Mason',       phone: '+254 700 001 001',
      dailyWage: 1800,      currency: 'KES',
      idNumber: 'ID-001001',
      emergencyContactName: 'Jane Kamau', emergencyContactPhone: '+254 700 001 002',
    },
    {
      id: 'demo-worker-000000-0000-0000-000000000002',
      firstName: 'John',    lastName: 'Odhiambo',
      trade: 'Carpenter',   phone: '+254 700 002 001',
      dailyWage: 1600,      currency: 'KES',
      idNumber: 'ID-002001',
      emergencyContactName: 'Mary Odhiambo', emergencyContactPhone: '+254 700 002 002',
    },
    {
      id: 'demo-worker-000000-0000-0000-000000000003',
      firstName: 'Samuel',  lastName: 'Njoroge',
      trade: 'Electrician', phone: '+254 700 003 001',
      dailyWage: 2200,      currency: 'KES',
      idNumber: 'ID-003001',
    },
    {
      id: 'demo-worker-000000-0000-0000-000000000004',
      firstName: 'David',   lastName: 'Otieno',
      trade: 'Plumber',     phone: '+254 700 004 001',
      dailyWage: 2000,      currency: 'KES',
      idNumber: 'ID-004001',
    },
    {
      id: 'demo-worker-000000-0000-0000-000000000005',
      firstName: 'Grace',   lastName: 'Wanjiku',
      trade: 'Labourer',    phone: '+254 700 005 001',
      dailyWage: 1200,      currency: 'KES',
      idNumber: 'ID-005001',
    },
  ];

  for (const w of workerSeedData) {
    await prisma.worker.upsert({
      where:  { id: w.id },
      update: {},
      create: { ...w, companyId: company.id, employmentStatus: 'active' },
    });
  }

  // Assign all 5 workers to the main site
  for (const w of workerSeedData) {
    const existing = await prisma.workerAssignment.findUnique({
      where: { siteId_workerId: { siteId: site.id, workerId: w.id } },
    });
    if (!existing) {
      await prisma.workerAssignment.create({
        data: {
          companyId:   company.id,
          projectId:   project.id,
          siteId:      site.id,
          workerId:    w.id,
          assignedById: owner.id,
        },
      });
    }
  }

  console.log(`Seeded ${workerSeedData.length} workers`);

  // ── Labour entries ────────────────────────────────────────────────────────
  const labourSeedData = [
    { workerId: 'demo-worker-000000-0000-0000-000000000001', date: new Date('2026-04-01'), hoursWorked: 8, dailyRate: 1800 },
    { workerId: 'demo-worker-000000-0000-0000-000000000002', date: new Date('2026-04-01'), hoursWorked: 8, dailyRate: 1600 },
    { workerId: 'demo-worker-000000-0000-0000-000000000003', date: new Date('2026-04-01'), hoursWorked: 8, dailyRate: 2200 },
    { workerId: 'demo-worker-000000-0000-0000-000000000001', date: new Date('2026-04-02'), hoursWorked: 8, dailyRate: 1800 },
    { workerId: 'demo-worker-000000-0000-0000-000000000004', date: new Date('2026-04-02'), hoursWorked: 6, dailyRate: 2000 },
    { workerId: 'demo-worker-000000-0000-0000-000000000005', date: new Date('2026-04-02'), hoursWorked: 8, dailyRate: 1200 },
  ];

  for (let i = 0; i < labourSeedData.length; i++) {
    const l = labourSeedData[i];
    const id = `demo-labour-entry-0000-0000-00000000000${i + 1}`;
    await prisma.labourEntry.upsert({
      where:  { id },
      update: {},
      create: {
        id,
        companyId:      company.id,
        projectId:      project.id,
        siteId:         site.id,
        workerId:       l.workerId,
        registeredById: siteSupervisor.id,
        date:           l.date,
        hoursWorked:    l.hoursWorked,
        dailyRate:      l.dailyRate,
        currency:       'KES',
      },
    });
  }

  console.log(`Seeded ${labourSeedData.length} labour entries`);

  // ── Attendance records ────────────────────────────────────────────────────
  const attendanceSeedData = [
    { workerId: 'demo-worker-000000-0000-0000-000000000001', date: new Date('2026-04-07'), status: 'present' as const,  checkInTime: '07:30', checkOutTime: '17:00' },
    { workerId: 'demo-worker-000000-0000-0000-000000000002', date: new Date('2026-04-07'), status: 'present' as const,  checkInTime: '07:45', checkOutTime: '17:00' },
    { workerId: 'demo-worker-000000-0000-0000-000000000003', date: new Date('2026-04-07'), status: 'late' as const,     checkInTime: '09:15', checkOutTime: '17:00', notes: 'Traffic on Waiyaki Way' },
    { workerId: 'demo-worker-000000-0000-0000-000000000004', date: new Date('2026-04-07'), status: 'present' as const,  checkInTime: '07:30', checkOutTime: '17:00' },
    { workerId: 'demo-worker-000000-0000-0000-000000000005', date: new Date('2026-04-07'), status: 'excused' as const,  notes: 'Medical appointment — clearance obtained' },
    { workerId: 'demo-worker-000000-0000-0000-000000000001', date: new Date('2026-04-06'), status: 'present' as const,  checkInTime: '07:30', checkOutTime: '17:00' },
    { workerId: 'demo-worker-000000-0000-0000-000000000002', date: new Date('2026-04-06'), status: 'half_day' as const, checkInTime: '07:30', checkOutTime: '12:30', notes: 'Left at noon — family emergency' },
    { workerId: 'demo-worker-000000-0000-0000-000000000003', date: new Date('2026-04-06'), status: 'absent' as const,   notes: 'No show — no prior notice' },
  ];

  for (let i = 0; i < attendanceSeedData.length; i++) {
    const a   = attendanceSeedData[i];
    const id  = `demo-attendance-0000-0000-0000-00000000000${i + 1}`;
    const existing = await prisma.attendanceRecord.findUnique({ where: { id } });
    if (!existing) {
      await prisma.attendanceRecord.create({
        data: {
          id,
          companyId:    company.id,
          projectId:    project.id,
          siteId:       site.id,
          workerId:     a.workerId,
          recordedById: siteSupervisor.id,
          date:         a.date,
          status:       a.status,
          checkInTime:  a.checkInTime  ?? null,
          checkOutTime: a.checkOutTime ?? null,
          notes:        a.notes        ?? null,
        },
      });
    }
  }

  console.log(`Seeded ${attendanceSeedData.length} attendance records`);

  // ── Daily targets ─────────────────────────────────────────────────────────
  const targetSeedData = [
    {
      id:          'demo-target-000000-0000-0000-000000000001',
      date:        new Date('2026-04-07'),
      description: 'Pour concrete slab — Level 3',
      targetValue: 50,
      targetUnit:  'm³',
      actualValue: 45,
      notes:       'Concrete mix: 1:2:4',
    },
    {
      id:          'demo-target-000000-0000-0000-000000000002',
      date:        new Date('2026-04-07'),
      description: 'Install window frames — Block A',
      targetValue: 20,
      targetUnit:  'units',
      actualValue: 20,
      notes:       'All frames installed and sealed',
    },
    {
      id:          'demo-target-000000-0000-0000-000000000003',
      date:        new Date('2026-04-07'),
      description: 'Lay brickwork — Ground floor east wall',
      targetValue: 500,
      targetUnit:  'bricks',
      workerId:    'demo-worker-000000-0000-0000-000000000001',
      notes:       'Mix ratio 1:3',
    },
    {
      id:          'demo-target-000000-0000-0000-000000000004',
      date:        new Date('2026-04-06'),
      description: 'Steel bar cutting and bending — Level 2',
      targetValue: 2000,
      targetUnit:  'kg',
      actualValue: 1800,
    },
    {
      id:          'demo-target-000000-0000-0000-000000000005',
      date:        new Date('2026-04-06'),
      description: 'Electrical conduit installation — Ground floor',
      targetValue: 80,
      targetUnit:  'metres',
      actualValue: 80,
      workerId:    'demo-worker-000000-0000-0000-000000000003',
      notes:       'Phase 1 complete',
    },
  ];

  for (const t of targetSeedData) {
    const existing = await prisma.dailyTarget.findUnique({ where: { id: t.id } });
    if (!existing) {
      await prisma.dailyTarget.create({
        data: {
          id:          t.id,
          companyId:   company.id,
          projectId:   project.id,
          siteId:      site.id,
          setById:     siteSupervisor.id,
          date:        t.date,
          description: t.description,
          targetValue: t.targetValue,
          targetUnit:  t.targetUnit,
          actualValue: t.actualValue ?? null,
          workerId:    t.workerId    ?? null,
          notes:       t.notes       ?? null,
        },
      });
    }
  }

  // Approve the first two targets
  await prisma.dailyTarget.updateMany({
    where: { id: { in: ['demo-target-000000-0000-0000-000000000001', 'demo-target-000000-0000-0000-000000000002'] } },
    data: { approvedById: siteSupervisor.id, approvedAt: new Date('2026-04-07T17:30:00Z') },
  });

  console.log(`Seeded ${targetSeedData.length} daily targets`);

  // ── Contractors ───────────────────────────────────────────────────────────
  const contractorReg = await prisma.contractor.upsert({
    where: { id: 'demo-contractor-0000-0000-000000000001' },
    update: {},
    create: {
      id:                  'demo-contractor-0000-0000-000000000001',
      companyId:           company.id,
      userId:              contractor.id,
      name:                'BuildRight Civil Works Ltd',
      contactPerson:       'Main Contractor',
      email:               'contractor@demo.com',
      phone:               '+254 700 111 000',
      registrationNumber:  'NCA-2021-1234',
      tradeSpecialization: 'Civil & Structural',
    },
  });

  const contractor2 = await prisma.contractor.upsert({
    where: { id: 'demo-contractor-0000-0000-000000000002' },
    update: {},
    create: {
      id:                  'demo-contractor-0000-0000-000000000002',
      companyId:           company.id,
      name:                'SteelPro Fabrications',
      contactPerson:       'James Mwangi',
      email:               'james@steelpro.co.ke',
      phone:               '+254 722 555 888',
      registrationNumber:  'NCA-2019-5678',
      tradeSpecialization: 'Structural Steel',
    },
  });

  console.log('Seeded 2 contractors');

  // ── Work Packages & Schedule Tasks ────────────────────────────────────────
  const pkg1 = await prisma.workPackage.upsert({
    where: { id: 'demo-workpkg-0000-0000-000000000001' },
    update: {},
    create: {
      id:           'demo-workpkg-0000-0000-000000000001',
      companyId:    company.id,
      projectId:    project.id,
      siteId:       site.id,
      contractorId: contractorReg.id,
      name:         'Foundation & Ground Slab',
      description:  'All foundation excavation, blinding, reinforcement and concrete works',
      area:         'Ground Floor',
      startDate:    new Date('2026-03-01'),
      endDate:      new Date('2026-04-30'),
      status:       'in_progress',
      createdById:  owner.id,
    },
  });

  await prisma.workPackage.upsert({
    where: { id: 'demo-workpkg-0000-0000-000000000002' },
    update: {},
    create: {
      id:           'demo-workpkg-0000-0000-000000000002',
      companyId:    company.id,
      projectId:    project.id,
      siteId:       site.id,
      contractorId: contractor2.id,
      name:         'Structural Steel Frame',
      description:  'Supply, fabricate and erect structural steel columns, beams and connections',
      area:         'Levels 1–4',
      startDate:    new Date('2026-05-01'),
      endDate:      new Date('2026-07-31'),
      status:       'not_started',
      createdById:  owner.id,
    },
  });

  const task1 = await prisma.scheduleTask.upsert({
    where: { id: 'demo-task-000000-0000-0000-000000000001' },
    update: {},
    create: {
      id:               'demo-task-000000-0000-0000-000000000001',
      companyId:        company.id,
      projectId:        project.id,
      siteId:           site.id,
      contractorId:     contractorReg.id,
      workPackageId:    pkg1.id,
      title:            'Foundation Excavation',
      description:      'Excavate to founding level as per structural drawings',
      area:             'Zone A — North Wing',
      materialsRequired: 'Nil — excavation only',
      equipmentRequired: '2x JCB excavators, 1x tipper truck',
      plannedStartDate:  new Date('2026-03-01'),
      plannedEndDate:    new Date('2026-03-15'),
      actualStartDate:   new Date('2026-03-02'),
      actualEndDate:     new Date('2026-03-14'),
      plannedProgress:   100,
      actualProgress:    100,
      status:            'completed',
      createdById:       owner.id,
    },
  });

  const task2 = await prisma.scheduleTask.upsert({
    where: { id: 'demo-task-000000-0000-0000-000000000002' },
    update: {},
    create: {
      id:               'demo-task-000000-0000-0000-000000000002',
      companyId:        company.id,
      projectId:        project.id,
      siteId:           site.id,
      contractorId:     contractorReg.id,
      workPackageId:    pkg1.id,
      title:            'Blinding & DPC Layer',
      description:      'Place 50mm concrete blinding and DPC membrane',
      area:             'Zone A — North Wing',
      materialsRequired: '50mm concrete blinding, DPC membrane 1000g',
      equipmentRequired: 'Concrete mixer, hand tools',
      plannedStartDate:  new Date('2026-03-15'),
      plannedEndDate:    new Date('2026-03-20'),
      actualStartDate:   new Date('2026-03-15'),
      plannedProgress:   100,
      actualProgress:    100,
      status:            'completed',
      createdById:       owner.id,
    },
  });

  const task3 = await prisma.scheduleTask.upsert({
    where: { id: 'demo-task-000000-0000-0000-000000000003' },
    update: {},
    create: {
      id:               'demo-task-000000-0000-0000-000000000003',
      companyId:        company.id,
      projectId:        project.id,
      siteId:           site.id,
      contractorId:     contractorReg.id,
      workPackageId:    pkg1.id,
      title:            'Foundation Reinforcement',
      description:      'Cut, bend and place Y16 and Y12 reinforcement bars per BBS',
      area:             'Zone A — North Wing',
      materialsRequired: 'Y16 bars — 8 tonnes, Y12 bars — 3 tonnes',
      equipmentRequired: 'Bar bender, bar cutter',
      plannedStartDate:  new Date('2026-03-20'),
      plannedEndDate:    new Date('2026-04-05'),
      actualStartDate:   new Date('2026-03-21'),
      plannedProgress:   100,
      actualProgress:    80,
      status:            'in_progress',
      comments:          'Bar delivery delayed by 3 days — back on track',
      createdById:       owner.id,
    },
  });

  const task4 = await prisma.scheduleTask.upsert({
    where: { id: 'demo-task-000000-0000-0000-000000000004' },
    update: {},
    create: {
      id:               'demo-task-000000-0000-0000-000000000004',
      companyId:        company.id,
      projectId:        project.id,
      siteId:           site.id,
      contractorId:     contractorReg.id,
      workPackageId:    pkg1.id,
      title:            'Foundation Concrete Pour',
      description:      'Pour foundation slab concrete C25/30 as per mix design',
      area:             'Zone A — North Wing',
      materialsRequired: '120m³ ready-mix C25/30 concrete',
      equipmentRequired: 'Concrete pump, vibrators',
      plannedStartDate:  new Date('2026-04-07'),
      plannedEndDate:    new Date('2026-04-10'),
      plannedProgress:   0,
      status:            'not_started',
      createdById:       owner.id,
    },
  });

  for (const [tId, dId] of [
    [task2.id, task1.id],
    [task3.id, task2.id],
    [task4.id, task3.id],
  ] as [string, string][]) {
    const existing = await prisma.scheduleDependency.findUnique({
      where: { taskId_dependsOnTaskId: { taskId: tId, dependsOnTaskId: dId } },
    });
    if (!existing) {
      await prisma.scheduleDependency.create({
        data: { companyId: company.id, taskId: tId, dependsOnTaskId: dId },
      });
    }
  }

  // Milestones
  const ms1Exists = await prisma.scheduleMilestone.findFirst({ where: { taskId: task4.id, name: 'Slab Pour Complete' } });
  if (!ms1Exists) {
    await prisma.scheduleMilestone.create({
      data: {
        companyId: company.id, projectId: project.id, siteId: site.id,
        taskId: task4.id, name: 'Slab Pour Complete',
        description: 'Foundation slab poured, levelled and curing started',
        plannedDate: new Date('2026-04-10'), status: 'pending',
      },
    });
  }
  const ms2Exists = await prisma.scheduleMilestone.findFirst({ where: { taskId: task1.id, name: 'Excavation Signed Off' } });
  if (!ms2Exists) {
    await prisma.scheduleMilestone.create({
      data: {
        companyId: company.id, projectId: project.id, siteId: site.id,
        taskId: task1.id, name: 'Excavation Signed Off',
        description: 'Geotechnical engineer approved founding level',
        plannedDate: new Date('2026-03-14'), actualDate: new Date('2026-03-14'), status: 'completed',
      },
    });
  }

  console.log('Seeded work packages, schedule tasks, milestones, and dependencies');

  // ── Drawings ─────────────────────────────────────────────────────────────
  const drawing1 = await prisma.drawing.upsert({
    where: { projectId_drawingNumber: { projectId: project.id, drawingNumber: 'A-001' } },
    update: {},
    create: {
      companyId:    company.id,
      projectId:    project.id,
      siteId:       site.id,
      drawingNumber: 'A-001',
      title:        'Ground Floor Architectural Plan',
      discipline:   'Architectural',
      createdById:  projectManager.id,
    },
  });

  const drawing2 = await prisma.drawing.upsert({
    where: { projectId_drawingNumber: { projectId: project.id, drawingNumber: 'S-001' } },
    update: {},
    create: {
      companyId:    company.id,
      projectId:    project.id,
      drawingNumber: 'S-001',
      title:        'Foundation Structural Layout',
      discipline:   'Structural',
      createdById:  projectManager.id,
    },
  });

  // Seed a revision on drawing1
  let rev1 = await prisma.drawingRevision.findFirst({ where: { drawingId: drawing1.id, revisionNumber: 'A' } });
  if (!rev1) {
    rev1 = await prisma.drawingRevision.create({
      data: {
        drawingId:      drawing1.id,
        companyId:      company.id,
        revisionNumber: 'A',
        fileUrl:        '/uploads/drawings/seed-a001-rev-a.pdf',
        fileKey:        'drawings/seed-a001-rev-a.pdf',
        fileName:       'A-001-Rev-A.pdf',
        fileSizeBytes:  512000,
        fileType:       'application/pdf',
        status:         'issued_for_construction',
        issueDate:      new Date('2026-02-15'),
        uploadedById:   projectManager.id,
        approvedById:   projectManager.id,
        approvedAt:     new Date('2026-02-20'),
        notes:          'Initial issue for construction',
      },
    });
    await prisma.drawing.update({
      where: { id: drawing1.id },
      data:  { currentRevisionId: rev1.id },
    });
  }

  let rev2 = await prisma.drawingRevision.findFirst({ where: { drawingId: drawing2.id, revisionNumber: 'A' } });
  if (!rev2) {
    rev2 = await prisma.drawingRevision.create({
      data: {
        drawingId:      drawing2.id,
        companyId:      company.id,
        revisionNumber: 'A',
        fileUrl:        '/uploads/drawings/seed-s001-rev-a.pdf',
        fileKey:        'drawings/seed-s001-rev-a.pdf',
        fileName:       'S-001-Rev-A.pdf',
        fileSizeBytes:  384000,
        fileType:       'application/pdf',
        status:         'issued_for_review',
        issueDate:      new Date('2026-03-01'),
        uploadedById:   consultant.id,
        notes:          'Issued for review — pending approval',
      },
    });
  }

  // Seed a comment on drawing1 revision
  const commentExists = await prisma.drawingComment.findFirst({ where: { drawingId: drawing1.id } });
  if (!commentExists) {
    await prisma.drawingComment.create({
      data: {
        companyId:  company.id,
        drawingId:  drawing1.id,
        revisionId: rev1.id,
        userId:     consultant.id,
        text:       'Beam dimensions on grid C3 need to be verified against structural calculations.',
      },
    });
  }

  console.log('Seeded drawings and revisions');

  // ── Consultant Instructions ───────────────────────────────────────────────
  const instr1Exists = await prisma.consultantInstruction.findFirst({
    where: { projectId: project.id, title: 'Verify founding level at grid D4' },
  });
  if (!instr1Exists) {
    await prisma.consultantInstruction.create({
      data: {
        companyId:       company.id,
        projectId:       project.id,
        siteId:          site.id,
        issuedById:      consultant.id,
        contractorId:    contractorRecord.id,
        type:            'instruction',
        title:           'Verify founding level at grid D4',
        category:        'Structural',
        priority:        'high',
        status:          'open',
        description:     'Contractor must expose founding level at grid D4 and notify engineer before pouring blinding concrete.',
        issuedDate:      new Date('2026-04-01'),
        targetActionDate: new Date('2026-04-08'),
        drawingId:       drawing2.id,
      },
    });
  }

  const instr2Exists = await prisma.consultantInstruction.findFirst({
    where: { projectId: project.id, title: 'Waterproofing membrane spec update' },
  });
  if (!instr2Exists) {
    await prisma.consultantInstruction.create({
      data: {
        companyId:      company.id,
        projectId:      project.id,
        issuedById:     consultant.id,
        type:           'recommendation',
        title:          'Waterproofing membrane spec update',
        category:       'Quality',
        priority:       'medium',
        status:         'acknowledged',
        description:    'Recommend upgrading basement waterproofing membrane from Type A to Type B (HDPE) for improved long-term performance.',
        issuedDate:     new Date('2026-03-28'),
        targetActionDate: new Date('2026-04-15'),
        drawingId:      drawing1.id,
      },
    });
  }

  console.log('Seeded consultant instructions');

  // ── Finance inflow ────────────────────────────────────────────────────────
  await prisma.financeInflow.upsert({
    where: { id: 'demo-finance-inflow-000000000001' },
    update: {},
    create: {
      id: 'demo-finance-inflow-000000000001',
      companyId: company.id,
      projectId: project.id,
      sourceType: 'sales_revenue',
      sourceName: 'Unit Pre-sales — Phase 1',
      amount: 85000000,
      currency: 'KES',
      transactionDate: new Date('2024-01-05'),
      referenceNumber: 'INV-PRE-001',
      recordedById: owner.id,
      notes: '17 units presold at average KES 5M each',
    },
  });

  // ── Invoices ───────────────────────────────────────────────────────────────
  const invoiceSeed = [
    {
      id:            'demo-invoice-0000-0000-0000-000000000001',
      invoiceNumber: 'INV-2026-001',
      vendorType:    'contractor' as const,
      contractorId:  'demo-contractor-0000-0000-0000-000000000001',
      vendorName:    'BuildRight Construction Ltd',
      budgetLineItemId: 'demo-budget-line-subcontractors',
      subtotal:      4500000,
      taxAmount:     675000,
      totalAmount:   5175000,
      paidAmount:    5175000,
      issueDate:     new Date('2026-01-15'),
      dueDate:       new Date('2026-02-14'),
      status:        'paid' as const,
      paidAt:        new Date('2026-02-10'),
      approvedById:  owner.id,
      approvedAt:    new Date('2026-01-20'),
      createdById:   financeOfficer.id,
      notes:         'Foundation works — Progress claim 1',
    },
    {
      id:            'demo-invoice-0000-0000-0000-000000000002',
      invoiceNumber: 'INV-2026-002',
      vendorType:    'supplier' as const,
      supplierId:    'demo-supplier-0000-0000-0000-000000000001',
      vendorName:    'East Africa Cement Ltd',
      budgetLineItemId: 'demo-budget-line-materials',
      subtotal:      1200000,
      taxAmount:     192000,
      totalAmount:   1392000,
      paidAmount:    1000000,
      issueDate:     new Date('2026-03-01'),
      dueDate:       new Date('2026-03-31'),
      status:        'partially_paid' as const,
      approvedById:  owner.id,
      approvedAt:    new Date('2026-03-05'),
      createdById:   financeOfficer.id,
      notes:         'Cement delivery batch 3 — partial payment pending',
    },
    {
      id:            'demo-invoice-0000-0000-0000-000000000003',
      invoiceNumber: 'INV-2026-003',
      vendorType:    'consultant' as const,
      consultantUserId: consultant.id,
      vendorName:    'Apex Engineers Ltd',
      budgetLineItemId: 'demo-budget-line-consultants',
      consultantCostEntryId: null as null,
      subtotal:      350000,
      taxAmount:     0,
      totalAmount:   350000,
      paidAmount:    0,
      issueDate:     new Date('2026-04-01'),
      dueDate:       new Date('2026-04-30'),
      status:        'approved' as const,
      approvedById:  owner.id,
      approvedAt:    new Date('2026-04-05'),
      createdById:   financeOfficer.id,
      notes:         'Structural engineering fees — Q1 2026',
    },
    {
      id:            'demo-invoice-0000-0000-0000-000000000004',
      invoiceNumber: 'INV-2026-004',
      vendorType:    'marketing' as const,
      vendorName:    'DigitalAds Kenya',
      budgetLineItemId: 'demo-budget-line-marketing',
      subtotal:      180000,
      taxAmount:     0,
      totalAmount:   180000,
      paidAmount:    0,
      issueDate:     new Date('2026-03-15'),
      dueDate:       new Date('2026-04-14'),
      status:        'submitted' as const,
      createdById:   projectManager.id,
      notes:         'Digital marketing campaign — March 2026',
    },
    {
      id:            'demo-invoice-0000-0000-0000-000000000005',
      invoiceNumber: 'INV-2026-005',
      vendorType:    'contractor' as const,
      contractorId:  'demo-contractor-0000-0000-0000-000000000001',
      vendorName:    'BuildRight Construction Ltd',
      budgetLineItemId: 'demo-budget-line-subcontractors',
      subtotal:      3200000,
      taxAmount:     480000,
      totalAmount:   3680000,
      paidAmount:    0,
      issueDate:     new Date('2026-04-01'),
      dueDate:       new Date('2026-04-30'),
      status:        'draft' as const,
      createdById:   financeOfficer.id,
      notes:         'Structural steel works — Progress claim 3',
    },
  ];

  for (const inv of invoiceSeed) {
    const { supplierId, consultantUserId, contractorId, consultantCostEntryId, ...rest } = inv as typeof inv & {
      supplierId?: string; consultantUserId?: string; contractorId?: string; consultantCostEntryId?: null;
    };
    await prisma.invoice.upsert({
      where:  { id: inv.id },
      update: {},
      create: {
        companyId:   company.id,
        projectId:   project.id,
        siteId:      site.id,
        currency:    'KES',
        ...rest,
        contractorId:      contractorId    ?? null,
        supplierId:        supplierId      ?? null,
        consultantUserId:  consultantUserId ?? null,
      },
    });
  }

  // Add payment records for paid invoice
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: 'demo-invoice-0000-0000-0000-000000000001' } });
  if (paidInvoice) {
    const existingPayments = await prisma.invoicePayment.findFirst({ where: { invoiceId: paidInvoice.id } });
    if (!existingPayments) {
      await prisma.invoicePayment.create({
        data: {
          invoiceId:   paidInvoice.id,
          companyId:   company.id,
          amount:      5175000,
          currency:    'KES',
          paymentDate: new Date('2026-02-10'),
          method:      'bank_transfer',
          reference:   'TXN-WOC-2026-0100',
          notes:       'EFT payment — BuildRight Construction progress claim 1',
          recordedById: financeOfficer.id,
        },
      });
    }
  }

  // Add partial payment for partially_paid invoice
  const partialInvoice = await prisma.invoice.findUnique({ where: { id: 'demo-invoice-0000-0000-0000-000000000002' } });
  if (partialInvoice) {
    const existingPayments = await prisma.invoicePayment.findFirst({ where: { invoiceId: partialInvoice.id } });
    if (!existingPayments) {
      await prisma.invoicePayment.create({
        data: {
          invoiceId:   partialInvoice.id,
          companyId:   company.id,
          amount:      1000000,
          currency:    'KES',
          paymentDate: new Date('2026-03-10'),
          method:      'eft',
          reference:   'TXN-WOC-2026-0200',
          notes:       'Partial payment on cement batch 3',
          recordedById: financeOfficer.id,
        },
      });
    }
  }

  // Add line items for the draft invoice
  const draftInvoice = await prisma.invoice.findUnique({ where: { id: 'demo-invoice-0000-0000-0000-000000000005' } });
  if (draftInvoice) {
    const existingLines = await prisma.invoiceLineItem.findFirst({ where: { invoiceId: draftInvoice.id } });
    if (!existingLines) {
      await prisma.invoiceLineItem.createMany({
        data: [
          { invoiceId: draftInvoice.id, companyId: company.id, description: 'Steel frame — floors B1 to G', quantity: 1, unitRate: 1800000, amount: 1800000 },
          { invoiceId: draftInvoice.id, companyId: company.id, description: 'Welding & connections',           quantity: 1, unitRate: 900000,  amount: 900000  },
          { invoiceId: draftInvoice.id, companyId: company.id, description: 'Site fixing & erection labour',  quantity: 1, unitRate: 500000,  amount: 500000  },
        ],
      });
    }
  }

  console.log(`Seeded ${invoiceSeed.length} invoices with payments and line items`);

  console.log('Seed complete.');
  console.log('\nDemo login credentials:');
  console.log('  Owner:      owner@demo.com      / Demo@1234');
  console.log('  Finance:    finance@demo.com     / Demo@1234');
  console.log('  PM:         pm@demo.com          / Demo@1234');
  console.log('  Supervisor: supervisor@demo.com  / Demo@1234');
  console.log('  Contractor: contractor@demo.com  / Demo@1234');
  console.log('  Consultant: engineer@demo.com    / Demo@1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
