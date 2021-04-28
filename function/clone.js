import * as Bucket from "@spica-devkit/bucket";
const fetch = require("node-fetch");
import { database, close, ObjectId } from "@spica-devkit/database";

export async function sender(req, res) {
    const { buckets, environments, server_name } = req.body;
    Bucket.initialize({ apikey: `${process.env.API_KEY}` });
    const HOST = req.headers.get("host");
    let spesificSchema = false;
    console.log(
        "buckets :",
        buckets,
        "environments : ",
        environments,
        "server_name : ",
        server_name
    );
    let schemas = await Bucket.getAll().catch(error =>
        console.log("get allBuckets error :", error)
    );
    if (buckets && buckets != "*") {
        schemas = schemas.filter(schema => JSON.stringify(buckets).indexOf(schema._id) > 0);
        spesificSchema = true;
    }
    let allFunctions = await getAllFunctions(HOST).catch(error =>
        console.log("get allfunctions error :", error)
    );

    for (const fn of allFunctions) {
        await getIndexes(fn._id, HOST)
            .then(index => {
                fn.index = index;
            })
            .catch(error => console.log("getIndexes error :", error));
        await getDependencies(fn._id, HOST)
            .then(dependency => {
                fn.dependencies = dependency;
            })
            .catch(error => console.log("getDependencies error :", error));
    }

    await fetch(`https://${server_name}.hq.spicaengine.com/api/fn-execute/receiver`, {
        method: "post",
        body: JSON.stringify({
            data: {
                schemas: schemas,
                allFunctions: allFunctions,
                spesificSchema: spesificSchema,
                env: !environments || environments == true ? true : false
            }
        }),
        headers: { "Content-Type": "application/json" }
    })
        .then(res => res.json())
        .then(async json => {
            return res.status(200).send({ message: "Ok" });
        })
        .catch(error => {
            console.log("error : ", error);
            return res.status(400).send({ message: error });
        });
}

async function getAllFunctions(HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}
async function getIndexes(id, HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/${id}/index`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}
async function getDependencies(id, HOST) {
    return new Promise(async (resolve, reject) => {
        await fetch(`https://${HOST}/api/function/${id}/dependencies`, {
            headers: {
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                resolve(json);
            })
            .catch(error => {
                reject(error);
                console.log("error : ", error);
            });
    });
}

export async function receiver(req, res) {
    console.log("-----------Clone Start--------------");
    const { data } = req.body;
    const HOST = req.headers.get("host");
    console.log("data : ", data);
    let removeBucketsPromises = [];
    let removeFunctionsPromises = [];

    Bucket.initialize({ apikey: `${process.env.API_KEY}` });

    /////////--------------Delete Buckets-----------------////////////
    if (data.spesificSchema)
        data.schemas.forEach(schema => removeBucketsPromises.push(Bucket.remove(schema._id)));
    else
        await Bucket.getAll()
            .then(schemas => schemas.forEach(b => removeBucketsPromises.push(Bucket.remove(b._id))))
            .catch(error => console.log("get allBuckets error :", error));
    if (removeBucketsPromises.length > 0)
        await Promise.all(removeBucketsPromises).catch(error =>
            console.log("removeBucketPromises Error : ", error)
        );
    /////////--------------Delete Buckets-----------------////////////

    /////////--------------Delete Functions-----------------////////////
    await getAllFunctions(HOST)
        .then(functions => {
            functions.forEach(f => {
                removeFunctionsPromises.push(
                    fetch(`https://${HOST}/api/function/${f._id}`, {
                        method: "DELETE",
                        headers: {
                            Authorization: `APIKEY ${process.env.API_KEY}`
                        }
                    })
                );
            });
        })
        .catch(error => console.log("getAllFunctions error :", error));
    /////////--------------Delete Functions-----------------////////////

    /////////--------------Insert Buckets-----------------////////////
    const db = await database();
    let collection_buckets = db.collection("buckets");
    if (data.schemas.length > 0) {
        data.schemas.forEach(schema => (schema._id = new ObjectId(schema._id)));
        await collection_buckets
            .insertMany(data.schemas)
            .then(data => {
                close();
            })
            .catch(error => {
                close();
                console.log("err insertmany buckets : ", error);
            });
    }
    /////////--------------Insert Buckets-----------------////////////

    /////////--------------Insert Functions-----------------////////////
    let tempDep;
    let tempIndex;
    for (const func of data.allFunctions) {
        delete func._id;
        tempDep = func.dependencies;
        tempIndex = func.index;
        delete func.index;
        delete func.dependencies;
        if (!data.env) func.env = {};
        console.log(func.name + " function inserting : ", func);
        await fetch(`https://${HOST}/api/function`, {
            method: "post",
            body: JSON.stringify(func),
            headers: {
                "Content-Type": "application/json",
                Authorization: `APIKEY ${process.env.API_KEY}`
            }
        })
            .then(res => res.json())
            .then(async json => {
                console.log("json : ", json, "tempIndex : ", tempIndex, "tempDep : ", tempDep)
                if (tempIndex.index) {
                    await fetch(`https://${HOST}/api/function/${json._id}/index`, {
                        method: "post",
                        body: JSON.stringify(tempIndex),

                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `APIKEY ${process.env.API_KEY}`
                        }
                    });
                }

                if (tempDep.length > 0) {
                    for (const dep of tempDep) {
                        await fetch(`https://${HOST}/api/function/${json._id}/dependencies`, {
                            method: "post",
                            body: JSON.stringify({ name: dep.name + "@" + dep.version }),
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `APIKEY ${process.env.API_KEY}`
                            }
                        });
                    }
                }
            })
            .catch(error => console.log("error when function insert", error));
    }
    /////////--------------Insert Functions-----------------////////////


    //------------------------------- Delete functions old
    await Promise.all(removeFunctionsPromises).catch(error =>
        console.log("removeFunctionPromises Error : ", error)
    );
    //-------------------------------
    console.log("-----------Clone Done--------------");
    return res.status(200).send({ message: "Ok receiver" });
}
