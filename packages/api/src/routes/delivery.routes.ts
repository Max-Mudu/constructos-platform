import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as deliveryService from '../services/delivery.service';
import { NotFoundError, handleError } from '../utils/errors';
import {
  storeFile,
  removeFile,
  validateMagicBytes,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../services/upload.service';
import { prisma } from '../utils/prisma';

const MAX_PHOTOS_PER_DELIVERY    = 20;
const MAX_DOCUMENTS_PER_DELIVERY = 10;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CONDITIONS  = ['good', 'damaged', 'partial', 'incorrect'] as const;
const INSPECTIONS = ['pending', 'passed', 'failed', 'waived']   as const;
const ACCEPTANCES = ['accepted', 'partially_accepted', 'rejected'] as const;

const createDeliverySchema = z.object({
  supplierName:        z.string().min(1).max(255),
  supplierContact:     z.string().max(255).optional(),
  deliveryDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  deliveryTime:        z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM').optional(),
  driverName:          z.string().max(255).optional(),
  vehicleRegistration: z.string().max(50).optional(),
  purchaseOrderNumber: z.string().max(100).optional(),
  deliveryNoteNumber:  z.string().max(100).optional(),
  invoiceNumber:       z.string().max(100).optional(),
  itemDescription:     z.string().min(1).max(1000),
  unitOfMeasure:       z.string().min(1).max(50),
  quantityOrdered:     z.number().positive(),
  quantityDelivered:   z.number().min(0),
  conditionOnArrival:  z.enum(CONDITIONS).default('good'),
  inspectionStatus:    z.enum(INSPECTIONS).default('pending'),
  acceptanceStatus:    z.enum(ACCEPTANCES).default('accepted'),
  rejectionReason:     z.string().max(1000).optional(),
  discrepancyNotes:    z.string().max(1000).optional(),
  receivedById:        z.string().uuid(),
  budgetLineItemId:    z.string().uuid().optional(),
  supplierInvoiceId:   z.string().uuid().optional(),
  comments:            z.string().max(2000).optional(),
});

const updateDeliverySchema = z.object({
  supplierName:        z.string().min(1).max(255).optional(),
  supplierContact:     z.string().max(255).nullish(),
  deliveryDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  deliveryTime:        z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  driverName:          z.string().max(255).nullish(),
  vehicleRegistration: z.string().max(50).nullish(),
  purchaseOrderNumber: z.string().max(100).nullish(),
  deliveryNoteNumber:  z.string().max(100).nullish(),
  invoiceNumber:       z.string().max(100).nullish(),
  itemDescription:     z.string().min(1).max(1000).optional(),
  unitOfMeasure:       z.string().min(1).max(50).optional(),
  quantityOrdered:     z.number().positive().optional(),
  quantityDelivered:   z.number().min(0).optional(),
  conditionOnArrival:  z.enum(CONDITIONS).optional(),
  inspectionStatus:    z.enum(INSPECTIONS).optional(),
  acceptanceStatus:    z.enum(ACCEPTANCES).optional(),
  rejectionReason:     z.string().max(1000).nullish(),
  discrepancyNotes:    z.string().max(1000).nullish(),
  budgetLineItemId:    z.string().uuid().nullish(),
  supplierInvoiceId:   z.string().uuid().nullish(),
  comments:            z.string().max(2000).nullish(),
});

// Roles that can view deliveries (read-only: finance, viewer; write: supervisor/pm/admin)
const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer'] as const;
const WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
// Only admin/PM can delete deliveries AND their attached files
const DELETE_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function deliveryRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/deliveries
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const deliveries = await deliveryService.listDeliveries(projectId, siteId, request.user);
        return reply.send({ deliveries });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/deliveries
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const delivery = await deliveryService.createDelivery(projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ delivery });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/deliveries/:deliveryId
  fastify.get(
    '/:deliveryId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, deliveryId } = request.params as {
          projectId: string; siteId: string; deliveryId: string;
        };
        const delivery = await deliveryService.getDelivery(deliveryId, projectId, siteId, request.user);
        return reply.send({ delivery });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/sites/:siteId/deliveries/:deliveryId
  fastify.patch(
    '/:deliveryId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId, deliveryId } = request.params as {
          projectId: string; siteId: string; deliveryId: string;
        };
        const delivery = await deliveryService.updateDelivery(
          deliveryId, projectId, siteId, parsed.data, request.user,
        );
        return reply.send({ delivery });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/sites/:siteId/deliveries/:deliveryId
  fastify.delete(
    '/:deliveryId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, deliveryId } = request.params as {
          projectId: string; siteId: string; deliveryId: string;
        };
        await deliveryService.deleteDelivery(deliveryId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Photos ────────────────────────────────────────────────────────────────

  // POST /:deliveryId/photos  — upload a photo (multipart/form-data, field: "file")
  fastify.post(
    '/:deliveryId/photos',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const { projectId, siteId, deliveryId } = request.params as {
        projectId: string; siteId: string; deliveryId: string;
      };

      // Verify delivery belongs to this company/project/site
      const delivery = await prisma.deliveryRecord.findFirst({
        where: { id: deliveryId, projectId, siteId, companyId: request.user.companyId },
        select: { id: true, _count: { select: { photos: true } } },
      });
      if (!delivery) return reply.status(404).send({ error: 'Delivery record not found', code: 'NOT_FOUND' });

      if (delivery._count.photos >= MAX_PHOTOS_PER_DELIVERY) {
        return reply.status(422).send({
          error: `Maximum ${MAX_PHOTOS_PER_DELIVERY} photos per delivery`,
          code: 'FILE_LIMIT_REACHED',
        });
      }

      let data: import('@fastify/multipart').MultipartFile | undefined;
      try {
        data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
      } catch {
        return reply.status(400).send({ error: 'File too large (max 20 MB)', code: 'FILE_TOO_LARGE' });
      }

      if (!data) {
        return reply.status(400).send({ error: 'No file provided', code: 'NO_FILE' });
      }

      if (!ALLOWED_IMAGE_TYPES.has(data.mimetype)) {
        return reply.status(422).send({
          error: 'Invalid file type. Allowed: JPEG, PNG, WEBP, GIF',
          code: 'INVALID_FILE_TYPE',
        });
      }

      const buffer = await data.toBuffer();

      if (!validateMagicBytes(buffer, data.mimetype)) {
        return reply.status(422).send({
          error: 'File content does not match declared type',
          code: 'INVALID_FILE_TYPE',
        });
      }

      const uploaded = await storeFile(buffer, data.filename, data.mimetype, 'photos');

      const photo = await prisma.deliveryPhoto.create({
        data: {
          deliveryRecordId: deliveryId,
          companyId:        request.user.companyId,
          fileUrl:          uploaded.fileUrl,
          fileKey:          uploaded.fileKey,
          fileName:         uploaded.fileName,
          fileSizeBytes:    uploaded.fileSizeBytes,
          uploadedById:     request.user.id,
        },
        select: {
          id: true, fileUrl: true,
          fileName: true, fileSizeBytes: true,
          uploadedById: true, createdAt: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          companyId:   request.user.companyId,
          userId:      request.user.id,
          userEmail:   request.user.email,
          userRole:    request.user.role,
          action:      'create',
          entityType:  'delivery_photo',
          entityId:    photo.id,
          changesAfter: { deliveryId, fileName: photo.fileName } as object,
        },
      });

      return reply.status(201).send({ photo });
    },
  );

  // DELETE /:deliveryId/photos/:photoId
  fastify.delete(
    '/:deliveryId/photos/:photoId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const { projectId, siteId, deliveryId, photoId } = request.params as {
        projectId: string; siteId: string; deliveryId: string; photoId: string;
      };

      const photo = await prisma.deliveryPhoto.findFirst({
        where: {
          id: photoId,
          deliveryRecordId: deliveryId,
          companyId: request.user.companyId,
          deliveryRecord: { projectId, siteId },
        },
        select: { id: true, fileKey: true, fileName: true },
      });

      if (!photo) {
        throw new NotFoundError('Photo');
      }

      await prisma.deliveryPhoto.delete({ where: { id: photoId } });
      await removeFile(photo.fileKey);

      await prisma.auditLog.create({
        data: {
          companyId:    request.user.companyId,
          userId:       request.user.id,
          userEmail:    request.user.email,
          userRole:     request.user.role,
          action:       'delete',
          entityType:   'delivery_photo',
          entityId:     photoId,
          changesBefore: { deliveryId, fileName: photo.fileName } as object,
        },
      });

      return reply.status(204).send();
    },
  );

  // ── Documents ─────────────────────────────────────────────────────────────

  // POST /:deliveryId/documents  — upload a document (multipart/form-data, field: "file")
  fastify.post(
    '/:deliveryId/documents',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const { projectId, siteId, deliveryId } = request.params as {
        projectId: string; siteId: string; deliveryId: string;
      };

      const delivery = await prisma.deliveryRecord.findFirst({
        where: { id: deliveryId, projectId, siteId, companyId: request.user.companyId },
        select: { id: true, _count: { select: { documents: true } } },
      });
      if (!delivery) return reply.status(404).send({ error: 'Delivery record not found', code: 'NOT_FOUND' });

      if (delivery._count.documents >= MAX_DOCUMENTS_PER_DELIVERY) {
        return reply.status(422).send({
          error: `Maximum ${MAX_DOCUMENTS_PER_DELIVERY} documents per delivery`,
          code: 'FILE_LIMIT_REACHED',
        });
      }

      let data: import('@fastify/multipart').MultipartFile | undefined;
      try {
        data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
      } catch {
        return reply.status(400).send({ error: 'File too large (max 20 MB)', code: 'FILE_TOO_LARGE' });
      }

      if (!data) {
        return reply.status(400).send({ error: 'No file provided', code: 'NO_FILE' });
      }

      if (!ALLOWED_DOCUMENT_TYPES.has(data.mimetype)) {
        return reply.status(422).send({
          error: 'Invalid file type. Allowed: PDF, images, Word, Excel',
          code: 'INVALID_FILE_TYPE',
        });
      }

      const buffer = await data.toBuffer();

      if (!validateMagicBytes(buffer, data.mimetype)) {
        return reply.status(422).send({
          error: 'File content does not match declared type',
          code: 'INVALID_FILE_TYPE',
        });
      }

      const uploaded = await storeFile(buffer, data.filename, data.mimetype, 'documents');

      const document = await prisma.deliveryDocument.create({
        data: {
          deliveryRecordId: deliveryId,
          companyId:        request.user.companyId,
          fileUrl:          uploaded.fileUrl,
          fileKey:          uploaded.fileKey,
          fileName:         uploaded.fileName,
          fileSizeBytes:    uploaded.fileSizeBytes,
          fileType:         uploaded.fileType,
          uploadedById:     request.user.id,
        },
        select: {
          id: true, fileUrl: true, fileName: true,
          fileSizeBytes: true, fileType: true, uploadedById: true, createdAt: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          companyId:   request.user.companyId,
          userId:      request.user.id,
          userEmail:   request.user.email,
          userRole:    request.user.role,
          action:      'create',
          entityType:  'delivery_document',
          entityId:    document.id,
          changesAfter: { deliveryId, fileName: document.fileName } as object,
        },
      });

      return reply.status(201).send({ document });
    },
  );

  // DELETE /:deliveryId/documents/:documentId
  fastify.delete(
    '/:deliveryId/documents/:documentId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const { projectId, siteId, deliveryId, documentId } = request.params as {
        projectId: string; siteId: string; deliveryId: string; documentId: string;
      };

      const document = await prisma.deliveryDocument.findFirst({
        where: {
          id: documentId,
          deliveryRecordId: deliveryId,
          companyId: request.user.companyId,
          deliveryRecord: { projectId, siteId },
        },
        select: { id: true, fileKey: true, fileName: true },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await prisma.deliveryDocument.delete({ where: { id: documentId } });
      await removeFile(document.fileKey);

      await prisma.auditLog.create({
        data: {
          companyId:    request.user.companyId,
          userId:       request.user.id,
          userEmail:    request.user.email,
          userRole:     request.user.role,
          action:       'delete',
          entityType:   'delivery_document',
          entityId:     documentId,
          changesBefore: { deliveryId, fileName: document.fileName } as object,
        },
      });

      return reply.status(204).send();
    },
  );
}
