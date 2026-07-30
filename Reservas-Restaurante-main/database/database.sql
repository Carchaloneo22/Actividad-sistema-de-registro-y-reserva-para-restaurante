CREATE DATABASE IF NOT EXISTS restaurante_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE restaurante_db;
-- Las tablas completas son creadas por las migraciones/Sequelize desde backend/src/models/index.js.
-- Este archivo crea la base y el usuario de aplicación; cambie la contraseña antes de producción.
CREATE USER IF NOT EXISTS 'restaurante_user'@'%' IDENTIFIED BY 'cambiar_esta_clave';
GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON restaurante_db.* TO 'restaurante_user'@'%';
FLUSH PRIVILEGES;

-- Después de actualizar una instalación existente ejecute desde backend:
-- npm.cmd run migrate:factus
-- npm.cmd run configure:v11-beta
-- npm.cmd run migrate:v11
-- V11 agrega Factus simulado, IVA 19% y propina voluntaria 10% sin borrar datos históricos.
