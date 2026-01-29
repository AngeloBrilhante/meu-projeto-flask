class Config:
    SECRET_KEY = "dev-secret-key"
    DEBUG = True


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
