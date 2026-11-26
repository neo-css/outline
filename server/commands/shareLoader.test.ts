import { faker } from "@faker-js/faker";
import { randomUUID } from "node:crypto";
import { addDays, subDays } from "date-fns";
import { DocumentPermission } from "@shared/types";
import { UserMembership } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { setSelfHosted } from "@server/test/support";
import { loadPublicShare, loadShareWithParent } from "./shareLoader";

describe("shareLoader", () => {
  describe("collection share", () => {
    it("should return share with tree and collection when requested with id", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        collectionId: collection.id,
      });

      const result = await loadPublicShare({
        id: share.id,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.collection?.id).toEqual(collection.id);
      expect(result.sharedTree?.id).toEqual(collection.id);
      expect(result.sharedTree?.url).toEqual(collection.path);
      expect(result.sharedTree?.children[0].id).toEqual(document.id);
      expect(result.sharedTree?.children[0].children[0].id).toEqual(
        childDocument.id
      );
      expect(result.document).toBeNull();
    });

    it("should return correct path for root node in sharedTree for domain", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        collectionId: collection.id,
        domain: faker.internet.domainName(),
      });

      const result = await loadPublicShare({
        id: share.id,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.collection?.id).toEqual(collection.id);
      expect(result.sharedTree?.id).toEqual(collection.id);
      expect(result.sharedTree?.url).toEqual("");
    });

    it("should return only share when requested with collectionId", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        collectionId: collection.id,
      });

      const result = await loadShareWithParent({
        collectionId: collection.id,
        user,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.parentShare).toBeNull();
    });

    it("should throw error when the requested collection is not part of the share", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const anotherCollection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        collectionId: collection.id,
      });

      await expect(
        loadPublicShare({ id: share.id, collectionId: anotherCollection.id })
      ).rejects.toThrow();
    });
  });

  describe("document share", () => {
    it("should return share with tree and document when requested with id", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        includeChildDocuments: true,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      const result = await loadPublicShare({
        id: share.id,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.document?.id).toEqual(document.id);
      expect(result.sharedTree?.id).toEqual(document.id);
      expect(result.sharedTree?.children.length).toEqual(1);
      expect(result.sharedTree?.children[0].id).toEqual(childDocument.id);
      expect(result.collection).toBeNull();
    });

    it("should not return share tree when includeChildDocuments is false", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        includeChildDocuments: false,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      const result = await loadPublicShare({
        id: share.id,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.document?.id).toEqual(document.id);
      expect(result.sharedTree).toBeNull();
      expect(result.collection).toBeNull();
    });

    it("should return share and parentShare when requested with documentId", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const [parentShare, share] = await Promise.all([
        buildShare({
          includeChildDocuments: true,
          userId: user.id,
          teamId: user.teamId,
          documentId: document.id,
        }),
        buildShare({
          includeChildDocuments: false,
          userId: user.id,
          teamId: user.teamId,
          documentId: childDocument.id,
        }),
      ]);

      const result = await loadShareWithParent({
        documentId: childDocument.id,
        user,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.parentShare?.id).toEqual(parentShare.id);
    });

    it("should not return parent collection share when user cannot read the collection", async () => {
      const admin = await buildUser();
      const member = await buildUser({ teamId: admin.teamId });
      const collection = await buildCollection({
        permission: null,
        userId: admin.id,
        teamId: admin.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: admin.id,
        teamId: admin.teamId,
      });
      await UserMembership.create({
        userId: member.id,
        documentId: document.id,
        permission: DocumentPermission.Read,
        createdById: admin.id,
      });
      const [, share] = await Promise.all([
        buildShare({
          userId: admin.id,
          teamId: admin.teamId,
          collectionId: collection.id,
        }),
        buildShare({
          userId: admin.id,
          teamId: admin.teamId,
          documentId: document.id,
        }),
      ]);

      const result = await loadShareWithParent({
        documentId: document.id,
        user: member,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.parentShare).toBeNull();
    });

    it("should not return an expired parentShare", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      await buildShare({
        includeChildDocuments: true,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
        expiresAt: subDays(new Date(), 1),
      });

      const result = await loadShareWithParent({
        documentId: childDocument.id,
        user,
      });

      expect(result.parentShare).toBeNull();
    });

    it("should return parentShare when the document has no share of its own", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const parentShare = await buildShare({
        includeChildDocuments: true,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      const result = await loadShareWithParent({
        documentId: childDocument.id,
        user,
      });

      expect(result.share).toBeNull();
      expect(result.parentShare?.id).toEqual(parentShare.id);
    });

    it("should not return parentShare when the user cannot read the document", async () => {
      const admin = await buildUser();
      const member = await buildUser({ teamId: admin.teamId });
      const collection = await buildCollection({
        permission: null,
        userId: admin.id,
        teamId: admin.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: admin.id,
        teamId: admin.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: admin.id,
        teamId: admin.teamId,
      });
      await buildShare({
        includeChildDocuments: true,
        userId: admin.id,
        teamId: admin.teamId,
        documentId: document.id,
      });

      await expect(
        loadShareWithParent({ documentId: childDocument.id, user: member })
      ).rejects.toThrow("Resource not found");
    });

    it("should return the share of a draft without a collection", async () => {
      const user = await buildUser();
      const document = await buildDocument({
        collectionId: null,
        publishedAt: null,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      const result = await loadShareWithParent({
        documentId: document.id,
        user,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.parentShare).toBeNull();
    });

    it("should not return parent document share when user cannot read the parent document", async () => {
      const admin = await buildUser();
      const member = await buildUser({ teamId: admin.teamId });
      const collection = await buildCollection({
        permission: null,
        userId: admin.id,
        teamId: admin.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: admin.id,
        teamId: admin.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        collectionId: collection.id,
        userId: admin.id,
        teamId: admin.teamId,
      });
      await UserMembership.create({
        userId: member.id,
        documentId: childDocument.id,
        permission: DocumentPermission.Read,
        createdById: admin.id,
      });
      const [, share] = await Promise.all([
        buildShare({
          includeChildDocuments: true,
          userId: admin.id,
          teamId: admin.teamId,
          documentId: document.id,
        }),
        buildShare({
          userId: admin.id,
          teamId: admin.teamId,
          documentId: childDocument.id,
        }),
      ]);

      const result = await loadShareWithParent({
        documentId: childDocument.id,
        user: member,
      });

      expect(result.share?.id).toEqual(share.id);
      expect(result.parentShare).toBeNull();
    });

    it("should throw error when the requested document is not part of the share (includeChildDocuments = true)", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const anotherDocument = await buildDocument({
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        includeChildDocuments: true,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      await expect(
        loadPublicShare({ id: share.id, documentId: anotherDocument.id })
      ).rejects.toThrow();
    });

    it("should throw error when the requested document is not part of the share (includeChildDocuments = false)", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const anotherDocument = await buildDocument({
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        includeChildDocuments: false,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      await expect(
        loadPublicShare({ id: share.id, documentId: anotherDocument.id })
      ).rejects.toThrow();
    });

    it("should throw error when the child document is requested for a share with includeChildDocuments = false", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const childDocument = await buildDocument({
        parentDocumentId: document.id,
        userId: user.id,
        teamId: user.teamId,
      });
      const share = await buildShare({
        includeChildDocuments: false,
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
      });

      await expect(
        loadPublicShare({ id: share.id, documentId: childDocument.id })
      ).rejects.toThrow();
    });
  });

  describe("inactive share when requested with id", () => {
    it("should throw error when share has expired", async () => {
      const share = await buildShare({
        expiresAt: subDays(new Date(), 1),
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should return share when expiry is in the future", async () => {
      const share = await buildShare({
        expiresAt: addDays(new Date(), 1),
      });

      const result = await loadPublicShare({ id: share.id });
      expect(result.share.id).toEqual(share.id);
    });

    it("should throw error when share is not published", async () => {
      const share = await buildShare({
        published: false,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when team has disabled sharing", async () => {
      const team = await buildTeam({
        sharing: false,
      });
      const share = await buildShare({
        teamId: team.id,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when team is suspended", async () => {
      const team = await buildTeam({
        suspendedAt: new Date(),
      });
      const share = await buildShare({
        teamId: team.id,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when collection has disabled sharing", async () => {
      const collection = await buildCollection({
        sharing: false,
      });
      const share = await buildShare({
        collectionId: collection.id,
        teamId: collection.teamId,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when collection is archived", async () => {
      const collection = await buildCollection({
        archivedAt: new Date(),
      });
      const share = await buildShare({
        collectionId: collection.id,
        teamId: collection.teamId,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when document is archived", async () => {
      const document = await buildDocument({
        archivedAt: new Date(),
      });
      const share = await buildShare({
        documentId: document.id,
        teamId: document.teamId,
      });

      await expect(loadPublicShare({ id: share.id })).rejects.toThrow();
    });

    it("should throw error when share belongs to another team", async () => {
      const team = await buildTeam();
      const share = await buildShare();

      await expect(
        loadPublicShare({ id: share.id, teamId: team.id })
      ).rejects.toThrow("Resource not found");
    });

    it("should require teamId for custom urlId when cloud hosted", async () => {
      const urlId = `slug-${randomUUID().slice(0, 8)}`;
      const user = await buildUser();
      await buildShare({
        userId: user.id,
        teamId: user.teamId,
        urlId,
      });

      await expect(loadPublicShare({ id: urlId })).rejects.toThrow(
        "teamId required for fetching share using urlId"
      );
    });

    it("should resolve a unique custom urlId without teamId when self hosted", async () => {
      setSelfHosted();
      const urlId = `slug-${randomUUID().slice(0, 8)}`;
      const user = await buildUser();
      const share = await buildShare({
        userId: user.id,
        teamId: user.teamId,
        urlId,
      });

      const result = await loadPublicShare({ id: urlId });
      expect(result.share.id).toEqual(share.id);
    });

    it("should reject an ambiguous custom urlId across self-hosted teams", async () => {
      setSelfHosted();
      const urlId = `slug-${randomUUID().slice(0, 8)}`;
      const userA = await buildUser();
      const userB = await buildUser();
      await buildShare({
        userId: userA.id,
        teamId: userA.teamId,
        urlId,
      });
      await buildShare({
        userId: userB.id,
        teamId: userB.teamId,
        urlId,
      });

      await expect(loadPublicShare({ id: urlId })).rejects.toThrow(
        "Resource not found"
      );
    });
  });
});
