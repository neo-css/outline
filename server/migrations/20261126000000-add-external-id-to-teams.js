"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "teams",
        "externalId",
        {
          type: Sequelize.STRING,
          allowNull: true,
        },
        { transaction }
      );
      await queryInterface.addIndex("teams", ["externalId"], {
        name: "teams_external_id",
        unique: true,
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("teams", "teams_external_id", {
        transaction,
      });
      await queryInterface.removeColumn("teams", "externalId", {
        transaction,
      });
    });
  },
};
