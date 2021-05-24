/*

What can this do ?
    * Clone your buckets schemas with same _id between your spica servers
    * Clone your functions with dependencies and environments between your spica servers

The process of this asset works as follows: Suppose the main server is A and B's cloning server. You must download this asset for both of these servers. 

    You should call the 'sender' function with Post method to A
        Body 
            {
                server_name -> Required! Your functions, dependencies of functions and buckets schemas will send to B
                (accepted : server_name for example "test-a1b2c")

                buckets -> if it is empty or  '*' then  your all buckets will send to B
                (accepted : * , with commas next to bucket id for example "bucket_id,bucket_id" or emtpy)

                environments -> if it is empty or  'true' then  your functions will send with environments to B
                (accepted : true , false or emtpy)
            }
You must raise the function maximum timeout up to 300 seconds from the Hq dashboard panel (advance settings)

*/

import * as Bucket from "@spica-devkit/bucket";
const fetch = require("node-fetch");
import { database, close, ObjectId } from "@spica-devkit/database";

export async function sender(req, res) {
    const { buckets, environments, server_name } = req.body;
    Bucket.initialize({ apikey: `${process.env.API_KEY}` });
    const HOST = req.headers.get("host");
    let spesificSchema = false;

    /////////--------------Get Schemas-----------------////////////
    let schemas = await Bucket.getAll().catch(error =>
        console.log("get allBuckets error :", error)
    );
    if (buckets && buckets != "*") {
        schemas = schemas.filter(schema => JSON.stringify(buckets).indexOf(schema._id) > 0);
        spesificSchema = true;
    }
    /////////--------------Get Schemas-----------------////////////

    /////////--------------Get Functions with dependencies and environments-----------------////////////
    let allFunctions = await getAllFunctions(HOST).catch(error =>
        console.log("get allfunctions error :", error)
    );


    let isIgnore = false;
    for (let [index, fn] of allFunctions.entries()) {
        Object.keys(fn.env).forEach(e => {
            if (e == "_IGNORE_") {
                isIgnore = true;
                allFunctions.splice(index, 1);
                return;
            }
        });
        if (!isIgnore) {
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
    }
    /////////--------------Get Functions with dependencies and environments-----------------////////////


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
        .then(_ => {
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
    let isIgnore = false;
    await getAllFunctions(HOST)
        .then(functions => {
            functions.forEach(f => {
                isIgnore = false;
                Object.keys(f.env).forEach(e => {
                    if (e == "_IGNORE_") {
                        isIgnore = true;
                        return;
                    }
                });
                if (!isIgnore) {
                    removeFunctionsPromises.push(
                        fetch(`https://${HOST}/api/function/${f._id}`, {
                            method: "DELETE",
                            headers: {
                                Authorization: `APIKEY ${process.env.API_KEY}`
                            }
                        })
                    );
                }
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
            .then(_ => {
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
        console.log(func.name + " function inserting");
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

                /////////--------------Insert Index-----------------////////////
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
                /////////--------------Insert Index-----------------////////////

                /////////--------------Insert Dependencies-----------------////////////
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
                /////////--------------Insert Dependencies-----------------////////////

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
