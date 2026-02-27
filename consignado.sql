-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: localhost    Database: consignado
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `clientes`
--

DROP TABLE IF EXISTS `clientes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clientes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendedor_id` int NOT NULL,
  `nome` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cpf` char(11) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data_nascimento` date NOT NULL,
  `especie` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uf_beneficio` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `numero_beneficio` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `salario` decimal(10,2) NOT NULL,
  `nome_mae` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rg_numero` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rg_orgao_exp` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rg_uf` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rg_data_emissao` date NOT NULL,
  `naturalidade` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telefone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cep` char(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rua` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `numero` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bairro` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `criado_em` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('RASCUNHO','EM_ANALISE','ANDAMENTO','APROVADA','REPROVADA') COLLATE utf8mb4_unicode_ci DEFAULT 'RASCUNHO',
  PRIMARY KEY (`id`),
  UNIQUE KEY `cpf` (`cpf`),
  UNIQUE KEY `uq_clientes_cpf` (`cpf`),
  KEY `idx_clientes_vendedor` (`vendedor_id`),
  CONSTRAINT `clientes_ibfk_1` FOREIGN KEY (`vendedor_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_clientes_vendedor` FOREIGN KEY (`vendedor_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clientes`
--

LOCK TABLES `clientes` WRITE;
/*!40000 ALTER TABLE `clientes` DISABLE KEYS */;
INSERT INTO `clientes` VALUES (1,3,'Moacir Osvaldo','11122233344','1987-06-02','041','CE','123.456.789-0',1600.00,'Maria Rosa ','12.345.678-9','SSPDS','CE','2010-08-02','Brasileira','85988516644','60781560','Rua Oliveira Martins','748','Passaré','2026-02-11 14:20:30','RASCUNHO'),(2,3,'Angelo Gabriel','45822233344','2006-04-04','041','CE','323.456.789-0',1600.00,'mara mendonça','12.345.679-9','SSPDS','CE','2009-06-25','Brasileira','85966448150','60781560','Rua Oliveira Martins','749','Passaré','2026-02-12 13:42:37','RASCUNHO'),(3,4,'Antônia Lisandra','14725836912','1987-12-25','041','CE','173.456.789-0',3200.00,'Maria Antonia','12.345.679-9','SSPDS','CE','2001-04-25','Brasileira','85912453678','60841560','Rua Palmares','458','Serrinha','2026-02-18 17:05:36','RASCUNHO'),(4,4,'Ana julia Lima','85479645802','2006-05-29','041','CE','123.456.789-0',4500.00,'Amanda Katiely','31.345.678-9','SSPDS','CE','2010-10-24','Brasileira','85945632148','60781560','Rua Palmares','748','Jangurussu','2026-02-22 01:18:54','RASCUNHO');
/*!40000 ALTER TABLE `clientes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `dashboard_goals`
--

DROP TABLE IF EXISTS `dashboard_goals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dashboard_goals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `vendedor_id` int NOT NULL DEFAULT '0',
  `target` int NOT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dashboard_goal_scope` (`year`,`month`,`vendedor_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dashboard_goals`
--

LOCK TABLES `dashboard_goals` WRITE;
/*!40000 ALTER TABLE `dashboard_goals` DISABLE KEYS */;
INSERT INTO `dashboard_goals` VALUES (1,2026,2,0,500000,2,'2026-02-21 22:13:06'),(2,2026,2,3,50000,2,'2026-02-20 11:32:40');
/*!40000 ALTER TABLE `dashboard_goals` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `documentos`
--

DROP TABLE IF EXISTS `documentos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documentos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` int NOT NULL,
  `seller_id` int NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `upload_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `documentos_ibfk_1` FOREIGN KEY (`id`) REFERENCES `clientes` (`id`),
  CONSTRAINT `documentos_ibfk_2` FOREIGN KEY (`id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `documentos`
--

LOCK TABLES `documentos` WRITE;
/*!40000 ALTER TABLE `documentos` DISABLE KEYS */;
/*!40000 ALTER TABLE `documentos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `operacoes`
--

DROP TABLE IF EXISTS `operacoes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `operacoes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cliente_id` int NOT NULL,
  `produto` enum('PORTABILIDADE','REFINANCIAMENTO','PORTABILIDADE_REFIN','NOVO','CARTAO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `banco_digitacao` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `margem` decimal(10,2) NOT NULL,
  `prazo` int NOT NULL,
  `valor_solicitado` decimal(10,2) DEFAULT NULL,
  `parcela_solicitada` decimal(10,2) DEFAULT NULL,
  `valor_liberado` decimal(10,2) DEFAULT NULL,
  `parcela_liberada` decimal(10,2) DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data_pagamento` date DEFAULT NULL,
  `criado_em` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status_fluxo` enum('RASCUNHO','ENVIADO','EM_ANALISE','APROVADO','RECUSADO') COLLATE utf8mb4_unicode_ci DEFAULT 'RASCUNHO',
  `link_formalizacao` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `devolvida_em` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente_id` (`cliente_id`),
  CONSTRAINT `operacoes_ibfk_1` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `operacoes`
--

LOCK TABLES `operacoes` WRITE;
/*!40000 ALTER TABLE `operacoes` DISABLE KEYS */;
INSERT INTO `operacoes` VALUES (1,2,'NOVO','c6',800.00,84,10000.00,500.00,NULL,NULL,'APROVADO',NULL,'2026-02-14 16:35:26','RASCUNHO',NULL,NULL),(2,1,'NOVO','c6',800.00,84,12000.00,600.00,NULL,NULL,'APROVADO',NULL,'2026-02-18 14:01:44','RASCUNHO',NULL,NULL),(3,1,'NOVO','Crefisa',500.00,84,5500.00,250.00,NULL,NULL,'APROVADO',NULL,'2026-02-18 14:29:25','RASCUNHO',NULL,NULL),(4,2,'NOVO','Crefisa',500.00,84,5500.00,550.00,NULL,NULL,'APROVADO',NULL,'2026-02-18 19:04:52','RASCUNHO',NULL,NULL),(5,3,'PORTABILIDADE_REFIN','c6',800.00,84,14000.00,740.00,13000.00,700.00,'APROVADO','2026-02-21','2026-02-18 21:26:43','RASCUNHO',NULL,NULL),(6,3,'PORTABILIDADE','c6',800.00,84,5500.00,550.00,5500.00,550.00,'APROVADO','2026-02-21','2026-02-20 11:58:24','RASCUNHO',NULL,NULL),(7,3,'PORTABILIDADE','Crefisa',560.00,84,7500.00,248.00,7500.00,248.00,'APROVADO','2026-02-21','2026-02-21 17:29:16','RASCUNHO',NULL,NULL),(8,3,'NOVO','Digio',600.00,72,8200.00,280.00,8200.00,280.00,'APROVADO','2026-02-21','2026-02-21 17:31:25','RASCUNHO',NULL,NULL),(9,3,'CARTAO','Crefisa',560.00,84,3000.00,149.00,3000.00,149.00,'DEVOLVIDA',NULL,'2026-02-21 17:42:40','RASCUNHO','https://www.youtube.com/','2026-02-21 14:43:19'),(10,4,'PORTABILIDADE','C6',600.00,84,12000.00,480.00,11000.00,300.00,'EM_ANALISE',NULL,'2026-02-22 01:20:06','RASCUNHO','https://docs.google.com/spreadsheets/d/1vCpldbOmZYWd1UYiirNBanOgvtGguuj1jqP20LJm75A/edit?gid=706978402#gid=706978402','2026-02-21 22:26:43');
/*!40000 ALTER TABLE `operacoes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `operation_comments`
--

DROP TABLE IF EXISTS `operation_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `operation_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operation_id` int NOT NULL,
  `author_id` int NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operation_comments_operation_created` (`operation_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `operation_comments`
--

LOCK TABLES `operation_comments` WRITE;
/*!40000 ALTER TABLE `operation_comments` DISABLE KEYS */;
INSERT INTO `operation_comments` VALUES (1,10,2,'Foto do documento não está clara','2026-02-22 11:26:46'),(2,10,4,'Irei enviar outra, só um momento.','2026-02-22 11:27:43');
/*!40000 ALTER TABLE `operation_comments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nome` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `senha_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `criado_em` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `role` enum('ADMIN','VENDEDOR','DIGITADOR_PORT_REFIN','DIGITADOR_NOVO_CARTAO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VENDEDOR',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES (2,'Admin Local','admin@teste.com','scrypt:32768:8:1$shzdxFPfp9dHwAVJ$23938c67d928898f3fd6a9e9ab20efefb2a27e82bcf700e4c4984ab8bafcfc5f821481e1c63e6f3c1b5e7cca6e5364de96bbcc2609555fcfe960b75c09b7f040','2026-02-10 11:40:43','ADMIN'),(3,'Vendedor Teste','vendedor@teste.com','scrypt:32768:8:1$RRwMre6N5iq6x8qR$ad953125fa4729007e9ab599edc22a7d5be723601359f118d2821ae763b45fca5c9f071f01857b2bac5725daea632a38a6feb905d2e071568bc80fdaff45095d','2026-02-11 12:13:27','VENDEDOR'),(4,'Vendedor Teste2','vendedor2@teste.com','scrypt:32768:8:1$N8D92Zuig84u6KZ5$9863596c469f3a44a08dac8d5a2132d40ce70e3ee1d8ed54c5b7397c93f48856768e49ae8251c64c9912f003e75b58a95b5e2554cf23524f6e31300c6c54d768','2026-02-12 11:19:24','VENDEDOR');
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-02-23 12:02:34
