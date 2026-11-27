"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "users",
        "workspaceAdminSourceId",
        { type: Sequelize.UUID, allowNull: true },
        { transaction }
      );
      await queryInterface.addIndex(
        "users",
        ["teamId", "workspaceAdminSourceId"],
        {
          name: "users_team_workspace_admin_source",
          unique: true,
          transaction,
        }
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Retain references to past actions and invalidate these accounts before
      // removing the field that distinguishes them from ordinary admins.
      await queryInterface.bulkUpdate(
        "users",
        { suspendedAt: new Date() },
        { workspaceAdminSourceId: { [Sequelize.Op.ne]: null } },
        { transaction }
      );

      await queryInterface.removeIndex(
        "users",
        "users_team_workspace_admin_source",
        {
          transaction,
        }
      );
      await queryInterface.removeColumn("users", "workspaceAdminSourceId", {
        transaction,
      });
    });
  },
};
