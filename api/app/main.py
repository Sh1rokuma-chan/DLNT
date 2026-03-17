from fastapi import FastAPI

from app.routers import chat, system

app = FastAPI()
app.include_router(system.router)
app.include_router(chat.router)
